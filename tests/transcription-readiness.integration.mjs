import test from 'node:test';
import assert from 'node:assert/strict';
import { access, chmod, mkdir, mkdtemp, open, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { transcriptionStatus, transcribeMedia, TRANSCRIPTION_MODEL } from './reference/server/transcription.mjs';
import { startServer } from './reference/server/app.mjs';

const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const absent = file => access(file).then(() => false, error => { if (error.code === 'ENOENT') return true; throw error; });
async function fixture(t, { engine = '1.9.3-dev', model = 'size', executable = true } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-readiness-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cli = path.join(directory, 'whisper-cli'), modelFile = path.join(directory, TRANSCRIPTION_MODEL.file), marker = path.join(directory, 'engine-started.json');
  if (engine === 'directory') await mkdir(cli);
  else if (engine !== null) {
    const entry = path.join(directory, 'engine.cjs');
    await writeFile(entry, `const fs = require('node:fs');\nfs.writeFileSync(${JSON.stringify(marker + '.tmp')}, JSON.stringify({pid:process.pid,args:process.argv.slice(2)}));\nfs.renameSync(${JSON.stringify(marker + '.tmp')}, ${JSON.stringify(marker)});\n` + (engine === 'hang' ? 'setInterval(() => {}, 1000);\n' : engine === 'fail' ? "process.stderr.write('PRIVATE_ENGINE_DIAGNOSTIC /test-only/hidden-engine-path'); process.exit(7);\n" : `process.stdout.write(${JSON.stringify(engine + '\n')});\n`));
    await writeFile(cli, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(entry)} "$@"\n`, { mode: executable ? 0o755 : 0o644 });
  }
  if (model === 'directory') await mkdir(modelFile);
  else if (model !== null) {
    const handle = await open(modelFile, 'wx');
    try { await handle.truncate(model === 'size' ? TRANSCRIPTION_MODEL.size : 1024); } finally { await handle.close(); }
  }
  return { directory, cli, modelFile, marker };
}
function unavailable(value, reason) {
  assert.equal(value.ready, false, JSON.stringify(value));
  assert.equal(value.reason, reason, JSON.stringify(value));
  assert.equal(value.local, true);
  assert.equal(value.model, TRANSCRIPTION_MODEL.name);
  assert.equal(typeof value.error, 'string'); assert.ok(value.error.length);
  assert.doesNotMatch(value.error, /PRIVATE_ENGINE_DIAGNOSTIC|hidden-engine-path|hypercut-readiness-|npm run/);
}
async function started(marker) {
  for (let i = 0; i < 200; i++) { if (!await absent(marker)) return JSON.parse(await readFile(marker, 'utf8')); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Engine subprocess did not start');
}
function exited(pid) {
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH', 'State-check subprocess must have exited');
}

test('R01: missing engine and missing model have different causes without running inference', async t => {
  const noEngine = await fixture(t, { engine: null });
  const noModel = await fixture(t, { model: null });
  const a = await transcriptionStatus(noEngine.directory), b = await transcriptionStatus(noModel.directory);
  unavailable(a, 'engine-missing'); unavailable(b, 'model-missing'); assert.notEqual(a.error, b.error);
  assert.equal(await absent(noEngine.marker), true); assert.equal(await absent(noModel.marker), true);
});

for (const [name, options, reason] of [
  ['engine directory', { engine: 'directory' }, 'engine-invalid'],
  ['model directory', { model: 'directory' }, 'model-invalid'],
  ['incomplete model', { model: 'short' }, 'model-incomplete'],
  ['non-executable engine', { executable: false }, 'engine-permission'],
]) test(`R02: ${name} fails before engine execution and preserves files`, async t => {
  const f = await fixture(t, options), before = await stat(f.modelFile);
  unavailable(await transcriptionStatus(f.directory), reason);
  const after = await stat(f.modelFile); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.equal(await absent(f.marker), true);
});

test('R02: unreadable model is not reported ready', async t => {
  const f = await fixture(t); await chmod(f.modelFile, 0);
  await assert.rejects(access(f.modelFile, constants.R_OK), error => error.code === 'EACCES');
  unavailable(await transcriptionStatus(f.directory), 'model-permission');
  assert.equal(await absent(f.marker), true);
});

for (const version of ['1.9.3', '1.9.3-dev', 'whisper.cpp version: 1.9.3', 'whisper.cpp version: 1.9.3-dev']) test(`R03/R06: supported ${version} is metadata-ready, not hash-verified`, async t => {
  const f = await fixture(t, { engine: version }), result = await transcriptionStatus(f.directory);
  assert.equal(result.ready, true); assert.equal(result.engine, version); assert.equal(result.local, true);
  assert.equal(result.integrity, 'checked-at-transcription'); assert.equal(result.error, undefined);
  const launch = await started(f.marker); assert.deepEqual(launch.args, ['--version']); exited(launch.pid);
});

for (const version of ['1.8.0', '1.9.30', '11.9.3', 'not a version', 'whisper.cpp version: 1.9.30', 'whisper.cpp version: 11.9.3']) test(`R03: unsupported version ${version} is rejected`, async t => {
  const f = await fixture(t, { engine: version }); unavailable(await transcriptionStatus(f.directory), 'engine-version');
  const launch = await started(f.marker); assert.deepEqual(launch.args, ['--version']); exited(launch.pid);
});

test('R04: subprocess failure is actionable without echoing private diagnostics', async t => {
  const f = await fixture(t, { engine: 'fail' }); unavailable(await transcriptionStatus(f.directory), 'engine-failed');
  exited((await started(f.marker)).pid);
});

test('R05: an already cancelled check never starts the engine', async t => {
  const f = await fixture(t), controller = new AbortController(); controller.abort();
  await assert.rejects(transcriptionStatus(f.directory, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await absent(f.marker), true);
});

test('R05: cancellation during version detection closes the actual subprocess', async t => {
  const f = await fixture(t, { engine: 'hang' }), controller = new AbortController();
  const pending = transcriptionStatus(f.directory, { signal: controller.signal }); pending.catch(() => {});
  const launch = await started(f.marker), at = performance.now(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.ok(performance.now() - at < 2000); exited(launch.pid);
});

test('R05: actual ten-second version timeout closes the subprocess and is distinguished from absence', { timeout: 16000 }, async t => {
  const f = await fixture(t, { engine: 'hang' }), at = performance.now();
  unavailable(await transcriptionStatus(f.directory), 'engine-timeout');
  const elapsed = performance.now() - at; assert.ok(elapsed >= 9500 && elapsed < 15000, String(elapsed));
  exited((await started(f.marker)).pid);
});

test('R06: same-size corrupt model cannot proceed from readiness to inference', async t => {
  const f = await fixture(t), before = await stat(f.modelFile);
  assert.equal((await transcriptionStatus(f.directory)).ready, true);
  await assert.rejects(transcribeMedia({ duration: 2, audioTracks: [{ index: 1, channels: 1 }] }, 1, { channel: 0, language: 'ko' }, f.directory, { runtime: f.directory }), /손상/);
  assert.deepEqual((await started(f.marker)).args, ['--version']);
  const after = await stat(f.modelFile); assert.equal(after.size, before.size); assert.equal(after.mtimeMs, before.mtimeMs);
});

test('R07: authenticated status API carries the specific cause and does not expose it without app authority', async t => {
  const f = await fixture(t, { model: null }), previous = process.env.HYPERCUT_TRANSCRIPTION_DIR;
  let server;
  process.env.HYPERCUT_TRANSCRIPTION_DIR = f.directory;
  try {
    server = await startServer({ port: 0, dataDir: path.join(f.directory, 'app') });
    assert.equal((await fetch(server.url + '/api/transcription/status')).status, 401);
    const { token } = await (await fetch(server.url + '/api/config')).json();
    const response = await fetch(server.url + '/api/transcription/status', { headers: { 'X-Hypercut-Token': token } });
    assert.equal(response.status, 200); unavailable(await response.json(), 'model-missing');
    assert.equal(await absent(f.marker), true);
  } finally {
    await server?.close();
    if (previous === undefined) delete process.env.HYPERCUT_TRANSCRIPTION_DIR; else process.env.HYPERCUT_TRANSCRIPTION_DIR = previous;
  }
});
