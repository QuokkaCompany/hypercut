import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat, copyFile } from 'node:fs/promises';
import { once } from 'node:events';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { downloadVerifiedFile, fileSHA256 } from '../scripts/helpers/verified-download.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.resolve(process.env.HYPERCUT_DOWNLOAD_TEST_OUTPUT || path.join(root, `test-output/model-download-recovery-${Date.now()}-${randomUUID()}`));
assert.ok(output.startsWith(path.join(root, 'test-output') + path.sep));
const driver = fileURLToPath(new URL('./helpers/download-process.mjs', import.meta.url));
const waitFor = async predicate => {
  const deadline = Date.now() + 10000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for the owned download process');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
};

test('verified downloads preserve previous files, reject partial data, and recover from real process signals', { timeout: 60000 }, async t => {
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output); // A new directory preserves evidence from earlier failures.
  console.log(JSON.stringify({ reportPath: path.join(output, 'results.json') }));
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-download-'));
  const payload = Buffer.alloc(128 * 1024 + 17);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 13 + (i >>> 7)) % 251;
  const sha256 = createHash('sha256').update(payload).digest('hex');
  const previous = Buffer.from('existing file must survive an incomplete replacement');
  const rows = [], requests = [], responseClosures = [], children = new Set();
  let truncatedResponse, heldResponse, completed = false;
  const server = createServer((request, response) => {
    requests.push(request.url);
    const connection = { path: request.url, closed: false };
    responseClosures.push(connection);
    response.once('close', () => { connection.closed = true; });
    if (request.url === '/error') { response.writeHead(503); response.end('unavailable'); return; }
    response.writeHead(200, { 'Content-Length': payload.length, 'Content-Type': 'application/octet-stream' });
    if (request.url === '/hold' || request.url === '/truncated') {
      if (request.url === '/truncated') truncatedResponse = response;
      else heldResponse = response;
      response.write(payload.subarray(0, 4096));
    } else if (request.url === '/wrong') response.end(Buffer.alloc(payload.length, 7));
    else response.end(payload);
  });
  t.after(async () => {
    await Promise.all([...children].map(child => {
      const closed = once(child, 'close'); child.kill('SIGKILL'); return closed;
    }));
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    const sources = ['scripts/helpers/verified-download.mjs', 'scripts/setup-transcription.mjs', 'tests/verified-download.integration.mjs', 'tests/helpers/download-process.mjs'];
    const report = {
      date: new Date().toISOString(), status: completed && rows.length && rows.every(row => row.status === 'PASS') ? 'RECORDED_PASS' : 'RECORDED_FAILURE',
      scope: 'Synthetic bytes over a real loopback HTTP server, isolated files and owned child processes. No model weights, engine builds, installed runtime, or external providers were used. Signal tests cover the download lifecycle only.',
      sourceHashes: Object.fromEntries(await Promise.all(sources.map(async file => [file, await fileSHA256(path.join(root, file))]))),
      legacyComparison: process.env.HYPERCUT_LEGACY_DOWNLOAD_DRIVER ? 'EXECUTED' : 'NOT_RUN',
      requests, responseClosures, cases: rows
    };
    if (process.env.HYPERCUT_LEGACY_DOWNLOAD_DRIVER) {
      const legacyDriver = path.resolve(process.env.HYPERCUT_LEGACY_DOWNLOAD_DRIVER);
      report.legacyDriver = { sha256: await fileSHA256(legacyDriver), source: await readFile(legacyDriver, 'utf8') };
    }
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    await copyFile(path.join(root, 'scripts/helpers/verified-download.mjs'), path.join(output, 'executed-download.mjs'));
    await copyFile(fileURLToPath(import.meta.url), path.join(output, 'executed-tests.mjs'));
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}`;
  const scenario = (name, action) => t.test(name, async () => {
    try { rows.push({ name, status: 'PASS', ...await action() }); }
    catch (error) { rows.push({ name, status: 'FAIL', error: error.message }); throw error; }
  });
  async function fixture(name) {
    const folder = path.join(directory, name); await mkdir(folder);
    const file = path.join(folder, 'model.bin'); await writeFile(file, previous);
    return { folder, file };
  }
  async function assertPrevious({ folder, file }) {
    assert.deepEqual(await readFile(file), previous);
    assert.deepEqual(await readdir(folder), ['model.bin']);
  }
  async function launch(config, name, legacy = false) {
    const configFile = path.join(output, `${name}-config.json`); await writeFile(configFile, JSON.stringify(config));
    const child = spawn(process.execPath, [legacy ? path.resolve(process.env.HYPERCUT_LEGACY_DOWNLOAD_DRIVER) : driver, configFile], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    const record = { stdout: '', stderr: '', ended: false };
    child.stdout.on('data', bytes => { record.stdout += bytes.toString(); });
    child.stderr.on('data', bytes => { record.stderr += bytes.toString(); });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { children.delete(child); record.ended = true; resolve({ code, signal }); });
    });
    done.catch(() => {});
    return { child, done, record, async progress(event = 'progress') {
      await waitFor(() => {
        if (legacy ? record.stdout.includes('MiB') : record.stdout.includes(`"event":"${event}"`)) return true;
        if (record.ended) throw new Error(`Download process ended before ${event}: ${record.stderr} ${record.stdout}`);
        return false;
      });
    } };
  }
  await scenario('successful download then verified reuse makes no new request', async () => {
    const f = await fixture('success');
    assert.equal((await downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length)).status, 'downloaded');
    assert.deepEqual(await readFile(f.file), payload);
    const count = requests.length;
    assert.equal((await downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length)).status, 'reused');
    assert.equal(requests.length, count);
    assert.deepEqual(await readdir(f.folder), ['model.bin']);
    return { sha256, bytes: payload.length, reuseRequests: 0 };
  });
  await scenario('first installation publishes verified bytes when the destination is absent', async () => {
    const f = await fixture('first-install'); await rm(f.file);
    const result = await downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length);
    assert.equal(result.status, 'downloaded'); assert.deepEqual(await readFile(f.file), payload);
    assert.deepEqual(await readdir(f.folder), ['model.bin']);
    return { sha256: await fileSHA256(f.file), bytes: result.bytes };
  });
  for (const [name, endpoint, maxBytes, pattern] of [
    ['wrong-hash', '/wrong', payload.length, /해시/],
    ['oversize', '/valid', payload.length - 1, /크기/],
    ['http-error', '/error', payload.length, /503/]
  ]) await scenario(name + ' preserves the prior file and removes only its temporary file', async () => {
    const f = await fixture(name);
    await assert.rejects(downloadVerifiedFile(url + endpoint, f.file, sha256, maxBytes), pattern);
    await assertPrevious(f); return { previousPreserved: true, temporaryFiles: 0 };
  });
  await scenario('a truncated response is not installed', async () => {
    const f = await fixture('truncated');
    await assert.rejects(downloadVerifiedFile(url + '/truncated', f.file, sha256, payload.length, { onProgress: () => truncatedResponse.destroy() }));
    await assertPrevious(f); return { previousPreserved: true, temporaryFiles: 0 };
  });
  await scenario('timeout cleans an unfinished response', async () => {
    const f = await fixture('timeout');
    await assert.rejects(downloadVerifiedFile(url + '/hold', f.file, sha256, payload.length, { timeoutMs: 100 }), error => error.name === 'TimeoutError');
    await waitFor(() => heldResponse?.destroyed);
    await assertPrevious(f); return { previousPreserved: true, temporaryFiles: 0, connectionClosed: true };
  });
  await scenario('a pre-cancelled request sends no HTTP request', async () => {
    const f = await fixture('pre-cancelled'), controller = new AbortController(); controller.abort();
    const count = requests.length;
    await assert.rejects(downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length, { signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(requests.length, count); await assertPrevious(f); return { newRequests: 0, previousPreserved: true };
  });
  if (process.env.HYPERCUT_LEGACY_DOWNLOAD_DRIVER) await scenario('the frozen previous implementation leaves partial data after SIGINT', async () => {
    const f = await fixture('legacy');
    const child = await launch({ url: url + '/hold', file: f.file, sha256, maxBytes: payload.length }, 'legacy', true);
    await child.progress(); child.child.kill('SIGINT');
    const exit = await child.done; assert.equal(exit.signal, 'SIGINT');
    await waitFor(() => heldResponse.destroyed);
    const partial = (await readdir(f.folder)).filter(name => name.endsWith('.download')); assert.equal(partial.length, 1);
    assert.ok((await stat(path.join(f.folder, partial[0]))).size > 0);
    assert.deepEqual(await readFile(f.file), previous);
    return { ...exit, partialFiles: partial, ...child.record };
  });
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) await scenario(signal + ' cleans partial data, preserves the old file and allows retry', async () => {
    const f = await fixture(signal);
    const child = await launch({ url: url + '/hold', file: f.file, sha256, maxBytes: payload.length }, signal);
    await child.progress(); child.child.kill(signal);
    const exit = await child.done; assert.deepEqual(exit, { code, signal: null });
    await waitFor(() => heldResponse.destroyed);
    await assertPrevious(f);
    assert.equal((await downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length)).status, 'downloaded');
    assert.deepEqual(await readFile(f.file), payload);
    return { ...exit, cleanedBeforeRetry: true, connectionClosed: true, retrySHA256: await fileSHA256(f.file), ...child.record };
  });
  await scenario('SIGKILL partial data is not reused or removed by a later attempt', async () => {
    const f = await fixture('SIGKILL');
    const child = await launch({ url: url + '/hold', file: f.file, sha256, maxBytes: payload.length }, 'SIGKILL');
    await child.progress(); child.child.kill('SIGKILL');
    const exit = await child.done; assert.equal(exit.signal, 'SIGKILL');
    await waitFor(() => heldResponse.destroyed);
    const partial = (await readdir(f.folder)).filter(name => name.endsWith('.download')); assert.equal(partial.length, 1);
    const partialPath = path.join(f.folder, partial[0]), before = await fileSHA256(partialPath);
    assert.deepEqual(await readFile(f.file), previous);
    assert.equal((await downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length)).status, 'downloaded');
    assert.equal(await fileSHA256(partialPath), before); assert.deepEqual(await readFile(f.file), payload);
    assert.equal((await readdir(f.folder)).length, 2);
    return { ...exit, priorPartialLeftIntact: true, retrySHA256: sha256, ...child.record };
  });
  await scenario('a late cancel stops preparation without rolling back verified published bytes', async () => {
    const f = await fixture('late-cancel');
    const child = await launch({ url: url + '/valid', file: f.file, sha256, maxBytes: payload.length, pauseAfterPublish: true }, 'late-cancel');
    await child.progress('published'); child.child.kill('SIGINT');
    const exit = await child.done; assert.deepEqual(exit, { code: 130, signal: null });
    assert.deepEqual(await readFile(f.file), payload); assert.deepEqual(await readdir(f.folder), ['model.bin']);
    const count = requests.length;
    assert.equal((await downloadVerifiedFile(url + '/valid', f.file, sha256, payload.length)).status, 'reused');
    assert.equal(requests.length, count);
    return { ...exit, completedFilePreserved: true, retryRequests: 0, ...child.record };
  });
  completed = true;
});
