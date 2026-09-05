import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { createClaudeCLI } from '../server/claude-cli.mjs';
import { fakeClaude } from './helpers/fake-claude.mjs';

test('A05/A06/A08: disconnect aborts stale proposals, duplicates are refused and keys never echo', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-ai-'));
  let respond, called;
  const started = new Promise(resolve => { called = resolve; });
  const server = await startServer({ port: 0, dataDir: directory, aiFetch: async (_url, options) => {
    called();
    return new Promise(resolve => { respond = () => resolve(Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify({ settings: DEFAULT_SETTINGS, explanation: '제안' }) }] }] })); });
  } });
  try {
    const { token } = await (await fetch(server.url + '/api/config')).json();
    const call = (route, body, method = body ? 'POST' : 'GET') => fetch(server.url + '/api/ai/' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: body && JSON.stringify(body) });
    assert.equal((await call('proposal', { instruction: 'test', settings: DEFAULT_SETTINGS })).status, 400);
    const configured = await call('connection', { provider: 'openai', model: 'test-model', apiKey: 'not-a-real-key' });
    assert.ok(!(await configured.text()).includes('not-a-real-key'));
    assert.ok(!(await (await call('connection')).text()).includes('not-a-real-key'));
    const pending = call('proposal', { instruction: 'keep', settings: DEFAULT_SETTINGS });
    await started;
    assert.equal((await call('proposal', { instruction: 'duplicate', settings: DEFAULT_SETTINGS })).status, 400);
    assert.equal((await call('connection', undefined, 'DELETE')).status, 200);
    respond();
    const old = await pending; assert.equal(old.status, 400); assert.match((await old.json()).error, /취소|폐기/);
    assert.equal((await call('proposal', { instruction: 'new', settings: DEFAULT_SETTINGS })).status, 400);
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test('A02/A06: real CLI process through API separates configuration, auth, verified response and usage', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cli-api-'));
  const fake = await fakeClaude(directory);
  const server = await startServer({ port: 0, dataDir: directory, claudeCLI: createClaudeCLI({ executable: fake.executable }) });
  try {
    const { token } = await (await fetch(server.url + '/api/config')).json();
    const call = (route, body, method = body ? 'POST' : 'GET') => fetch(server.url + '/api/ai/' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: body && JSON.stringify(body) });
    await fake.set({ loggedIn: false });
    const absent = await (await call('claude/status')).json(); assert.equal(absent.ready, false); assert.ok(!JSON.stringify(absent).includes('private'));
    await call('connection', { provider: 'claude_cli', model: 'selected-model' });
    assert.equal((await (await call('connection')).json()).verified, false);
    assert.equal((await call('proposal', { instruction: 'edit', settings: DEFAULT_SETTINGS })).status, 400);
    await assert.rejects(readFile(fake.record), { code: 'ENOENT' });
    await fake.set({}); assert.equal((await (await call('claude/status')).json()).ready, true);
    const response = await call('proposal', { instruction: 'edit', settings: DEFAULT_SETTINGS });
    assert.equal(response.status, 200); assert.equal((await response.json()).settings.minSilenceMs, 700);
    const state = await (await call('connection')).json(); assert.equal(state.verified, true); assert.equal(state.lastExecution.inputTokens, 123);
    assert.ok(!JSON.stringify(state).includes('private'));
    await call('connection', undefined, 'DELETE'); assert.deepEqual(await (await call('connection')).json(), { connected: false });
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test('A04/A08: app shutdown waits for an active CLI request to terminate', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cli-shutdown-'));
  const fake = await fakeClaude(directory); await fake.set({ delayMs: 30000 });
  const server = await startServer({ port: 0, dataDir: directory, claudeCLI: createClaudeCLI({ executable: fake.executable }) });
  let closed = false;
  try {
    const { token } = await (await fetch(server.url + '/api/config')).json();
    const options = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: JSON.stringify(body) });
    await fetch(server.url + '/api/ai/connection', options({ provider: 'claude_cli', model: 'sonnet' }));
    const result = fetch(server.url + '/api/ai/proposal', options({ instruction: 'wait', settings: DEFAULT_SETTINGS })).then(r => r.status, () => 'closed');
    let running = false;
    for (let i = 0; i < 200; i++) { if (await readFile(fake.record).catch(() => null)) { running = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(running); const start = performance.now(); await server.close(); closed = true;
    assert.ok(performance.now() - start < 2000); assert.notEqual(await result, 200);
  } finally { if (!closed) await server.close(); await rm(directory, { recursive: true, force: true }); }
});
