import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startServer } from '../server/app.mjs';
import { bridgeConfiguration } from '../server/mcp-bridge.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { effectProposalFixture } from './helpers/effect-proposal-fixture.mjs';

async function fixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-mcp-'));
  let modelCalls = 0;
  const server = await startServer({ port: 0, dataDir: directory, aiFetch: async () => { modelCalls++; throw new Error('Unexpected model call'); } });
  t.after(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); assert.equal(modelCalls, 0); });
  const { token } = await (await fetch(`${server.url}/api/config`)).json();
  const call = (route, body, method = body ? 'POST' : 'GET', headers = { 'X-Hypercut-Token': token }) => fetch(`${server.url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { server, token, call };
}
const input = () => ({ task: 'settings', request: { instruction: '작은 목소리 보존', settings: DEFAULT_SETTINGS } });
const proposal = () => ({ settings: { ...DEFAULT_SETTINGS, minSilenceMs: 800 }, explanation: '짧은 쉼 보존' });
const value = (s, p = proposal()) => ({ contextVersion: s.contextVersion, proposalId: randomUUID(), proposal: p });

test('MCP HTTP boundary keeps editor authority separate from the share capability', async t => {
  const { call, token } = await fixture(t);
  assert.equal((await call('/ai/shares', input(), 'POST', {})).status, 401);
  const s = await (await call('/ai/shares', input())).json();
  const headers = { 'X-Hypercut-Share-Capability': s.capability };
  assert.equal(s.connection.env.HYPERCUT_MCP_CAPABILITY, s.capability);
  assert.ok(!JSON.stringify(s).includes(token));
  for (const [route, method] of [[`/ai/shares/${s.shareId}`, 'GET'], [`/ai/shares/${s.shareId}`, 'DELETE'], [`/ai/shares/${s.shareId}/resolution`, 'POST'], ['/jobs', 'POST'], ['/ai/connection', 'DELETE']]) assert.equal((await call(route, method === 'POST' ? {} : undefined, method, headers)).status, 401);
  assert.equal((await call(`/mcp-exchange/${s.shareId}`, undefined, 'GET', { 'X-Hypercut-Token': token })).status, 401);
  assert.equal((await call(`/mcp-exchange/${s.shareId}?capability=${s.capability}`, undefined, 'GET', {})).status, 401);
  assert.equal((await call(`/mcp-exchange/${s.shareId}`, undefined, 'GET', { ...headers, Origin: 'https://unrelated.example' })).status, 403);
  assert.equal((await call(`/mcp-exchange/${s.shareId}`, undefined, 'GET', { ...headers, 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const read = await call(`/mcp-exchange/${s.shareId}`, undefined, 'GET', headers);
  assert.equal(read.status, 200); assert.equal(read.headers.get('cache-control'), 'no-store');
  assert.ok(!(await read.text()).includes(s.capability));
  assert.equal((await call(`/mcp-exchange/${s.shareId}/proposals`, value(s), 'POST', headers)).status, 200);
  assert.equal((await (await call(`/ai/shares/${s.shareId}`)).json()).status, 'proposed');
  await call(`/ai/shares/${s.shareId}`, undefined, 'DELETE');
  assert.equal((await call(`/mcp-exchange/${s.shareId}`, undefined, 'GET', headers)).status, 404);
  assert.equal((await call(`/mcp-exchange/${s.shareId}/proposals`, value(s), 'POST', headers)).status, 404);
});

test('oversized and malformed share bodies are rejected without echoing the body', async t => {
  const { call, server, token } = await fixture(t);
  assert.equal((await call('/ai/shares', { task: 'settings', request: { instruction: '한'.repeat(128 * 1024) } })).status, 413);
  const response = await fetch(`${server.url}/api/ai/shares`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: '{"PRIVATE_UNFINISHED_CAPTION' });
  assert.equal(response.status, 400); assert.doesNotMatch(await response.text(), /PRIVATE/);
  assert.equal((await call('/ai/shares', input())).status, 200);
});

for (const task of ['settings', 'correction', 'effects']) test(`real MCP stdio child: ${task} context, proposal, retry and application receipt`, async t => {
  const { call } = await fixture(t);
  const { input: effects, proposal: effectProposal } = effectProposalFixture();
  const caption = { requestId: randomUUID(), instruction: '오타 교정', glossary: '', cues: [{ id: 'c1', text: '자막 입니디.' }] };
  const shared = task === 'settings' ? input() : { task, request: task === 'effects' ? effects : caption };
  const expected = task === 'settings' ? proposal() : task === 'effects' ? effectProposal : { requestId: caption.requestId, changes: [{ id: 'c1', before: caption.cues[0].text, after: '자막입니다.', reason: '오타 수정' }] };
  const s = await (await call('/ai/shares', shared)).json();
  const transport = new StdioClientTransport({ ...s.connection, stderr: 'pipe' });
  const client = new Client({ name: 'hypercut-protocol-verification', version: '1.0.0' });
  let errors = ''; transport.stderr.on('data', chunk => { errors += chunk; });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    assert.deepEqual(listing.tools.map(x => x.name).sort(), ['get_shared_edit_context', 'submit_edit_proposal']);
    for (const tool of listing.tools) { assert.ok(tool.inputSchema); assert.ok(tool.outputSchema); assert.equal(tool.annotations.openWorldHint, false); }
    const read = await client.callTool({ name: 'get_shared_edit_context', arguments: {} });
    assert.ok(!read.isError); assert.equal(read.structuredContent.task, task); assert.deepEqual(read.structuredContent.context.request, shared.request);
    assert.doesNotMatch(JSON.stringify(read), /capability|private-filename|local-media-id/);
    const invalidScope = await client.callTool({ name: 'get_shared_edit_context', arguments: { shareId: randomUUID() } }); assert.equal(invalidScope.isError, true);
    const submission = value(s, expected);
    assert.equal((await client.callTool({ name: 'submit_edit_proposal', arguments: { ...submission, contextVersion: randomUUID() } })).isError, true);
    const submitted = await client.callTool({ name: 'submit_edit_proposal', arguments: submission });
    assert.ok(!submitted.isError, JSON.stringify(submitted)); assert.equal(submitted.structuredContent.status, 'proposed');
    assert.deepEqual((await (await call(`/ai/shares/${s.shareId}`)).json()).proposal, expected);
    const duplicate = await client.callTool({ name: 'submit_edit_proposal', arguments: submission }); assert.equal(duplicate.structuredContent.proposalId, submission.proposalId);
    assert.equal((await client.callTool({ name: 'submit_edit_proposal', arguments: value(s, expected) })).isError, true);
    const resolution = await call(`/ai/shares/${s.shareId}/resolution`, { contextVersion: s.contextVersion, proposalId: submission.proposalId, outcome: 'applied', selectedIds: task === 'settings' ? ['settings'] : [expected.changes[0].id] });
    assert.equal(resolution.status, 200);
    const receipt = (await client.callTool({ name: 'get_shared_edit_context', arguments: {} })).structuredContent;
    assert.equal(receipt.status, 'applied'); assert.equal(receipt.context, null);
    await call(`/ai/shares/${s.shareId}`, undefined, 'DELETE');
    assert.equal((await client.callTool({ name: 'get_shared_edit_context', arguments: {} })).isError, true);
  } finally { await client.close(); }
  assert.equal(errors, '');
});

test('adapter configuration refuses remote URLs, alternate hosts, credentials and path injection', () => {
  const env = { HYPERCUT_MCP_URL: 'http://127.0.0.1:4327', HYPERCUT_MCP_SHARE: randomUUID(), HYPERCUT_MCP_CAPABILITY: 'a'.repeat(64) };
  assert.equal(bridgeConfiguration(env).baseURL, env.HYPERCUT_MCP_URL);
  for (const url of ['https://example.com', 'http://localhost:4327', 'http://127.0.0.1:4327/api/config', 'http://user:pass@127.0.0.1:4327', 'http://127.0.0.1:65536', 'http://127.0.0.1:4327?token=x']) assert.throws(() => bridgeConfiguration({ ...env, HYPERCUT_MCP_URL: url }));
  assert.throws(() => bridgeConfiguration({ ...env, HYPERCUT_MCP_SHARE: '../config' }));
  assert.throws(() => bridgeConfiguration({ ...env, HYPERCUT_MCP_CAPABILITY: '' }));
});

test('restarting the MCP child reuses a live share without duplicating or losing a pending proposal', async t => {
  const { call } = await fixture(t), s = await (await call('/ai/shares', input())).json(), submission = value(s);
  async function connect() { const client = new Client({ name: 'restart-test', version: '1' }); await client.connect(new StdioClientTransport({ ...s.connection, stderr: 'pipe' })); return client; }
  const first = await connect();
  try { assert.equal((await first.callTool({ name: 'submit_edit_proposal', arguments: submission })).structuredContent.status, 'proposed'); }
  finally { await first.close(); }
  const second = await connect();
  try {
    const read = await second.callTool({ name: 'get_shared_edit_context', arguments: {} });
    assert.equal(read.structuredContent.proposalId, submission.proposalId);
    assert.equal((await second.callTool({ name: 'submit_edit_proposal', arguments: submission })).structuredContent.status, 'proposed');
    assert.deepEqual((await (await call(`/ai/shares/${s.shareId}`)).json()).proposal, submission.proposal);
    await call(`/ai/shares/${s.shareId}/resolution`, { contextVersion: s.contextVersion, proposalId: submission.proposalId, outcome: 'rejected', selectedIds: [] });
    const receipt = (await second.callTool({ name: 'get_shared_edit_context', arguments: {} })).structuredContent;
    assert.equal(receipt.status, 'rejected'); assert.equal(receipt.context, null);
  } finally { await second.close(); }
});
