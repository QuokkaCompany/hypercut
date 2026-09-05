import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';

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
