import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const configuration = url => ({ command: process.execPath, args: ['server/mcp-stdio.mjs'], env: { HYPERCUT_MCP_URL: url, HYPERCUT_MCP_SHARE: randomUUID(), HYPERCUT_MCP_CAPABILITY: 'b'.repeat(64) } });
async function rawChild(t) {
  const config = configuration('http://127.0.0.1:1');
  const child = spawn(config.command, config.args, { env: config.env, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  let stdout = '', stderr = '', ready, reject;
  const initialized = new Promise((resolve, no) => { ready = resolve; reject = no; });
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  child.on('error', reject); child.stdin.on('error', () => {});
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdout.on('data', chunk => {
    stdout += chunk;
    const line = stdout.split('\n')[0];
    if (stdout.includes('\n')) { try { ready(JSON.parse(line)); } catch (e) { reject(e); } }
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'legacy-test', version: '1' } } }) + '\n');
  const message = await initialized;
  assert.equal(message.result.protocolVersion, '2025-06-18');
  assert.equal(message.result.serverInfo.name, 'hypercut-edit-proposals');
  return { child, exited, output: () => ({ stdout, stderr }) };
}

test('legacy MCP initialization and stdin EOF terminate without orphaning the adapter', { timeout: 5000 }, async t => {
  const { child, exited, output } = await rawChild(t); child.stdin.end();
  assert.deepEqual(await exited, { code: 0, signal: null }); assert.equal(output().stderr, '');
});
test('SIGTERM after initialization closes the stdio adapter', { timeout: 5000 }, async t => {
  const { child, exited } = await rawChild(t); child.kill('SIGTERM');
  assert.deepEqual(await exited, { code: 143, signal: null });
});
test('oversized stdio message closes before unbounded JSON parsing and never echoes data', { timeout: 5000 }, async t => {
  const { child, exited, output } = await rawChild(t);
  child.stdin.write('PRIVATE_PAYLOAD'.repeat(12000));
  assert.deepEqual(await exited, { code: 1, signal: null });
  assert.doesNotMatch(output().stdout + output().stderr, /PRIVATE_PAYLOAD|bbbbbbbb/);
  assert.match(output().stderr, /메시지를 처리할 수 없습니다/);
});

test('actual stalled loopback HTTP request times out, aborts the socket and leaves the MCP client usable', { timeout: 12000 }, async t => {
  let opened = 0, closed = 0;
  const http = createServer((req, res) => { opened++; res.on('close', () => { closed++; }); });
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  t.after(async () => { http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); });
  const transport = new StdioClientTransport({ ...configuration(`http://127.0.0.1:${http.address().port}`), stderr: 'pipe' });
  const client = new Client({ name: 'timeout-test', version: '1' }); t.after(() => client.close());
  await client.connect(transport);
  const start = performance.now(), result = await client.callTool({ name: 'get_shared_edit_context', arguments: {} });
  assert.equal(result.isError, true); assert.match(result.content[0].text, /제한 시간/);
  const elapsed = performance.now() - start; assert.ok(elapsed >= 4500 && elapsed < 8000);
  for (let i = 0; i < 100 && closed !== opened; i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(opened, 1); assert.equal(closed, 1);
  assert.equal((await client.listTools()).tools.length, 2);
});
