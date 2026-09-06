import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { assertCacheObservation, createFileCacheController } from '../scripts/helpers/file-cache.mjs';

test('input-file cache controller observes the selection boundary and preserves bytes', { skip: process.platform !== 'darwin' }, async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cache-integration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'synthetic-odd-length.bin');
  const bytes = Buffer.alloc(1024 * 1024 + 37);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + (i >>> 8)) % 251;
  await writeFile(source, bytes);
  const expectedSHA256 = createHash('sha256').update(bytes).digest('hex');
  const controller = await createFileCacheController(directory);
  for (const mode of ['cold', 'warm']) {
    await t.test(`${mode} input passes real native observations and post-analysis hash`, async () => {
      const attempt = await controller.prepare({ source, prefix: mode, mode, expectedSHA256 });
      await controller.beforeSelection(attempt);
      assert.equal(attempt.beforeSelection.residentPages, mode === 'cold' ? 0 : attempt.beforeSelection.pages);
      assert.equal(attempt.actualSHA256, undefined);
      controller.markSelection(attempt);
      assert.deepEqual(await readFile(attempt.file), bytes); // Simulate the consumer's first read.
      await controller.afterAnalysis(attempt);
      await controller.afterRun(attempt);
      const saved = JSON.parse(await readFile(path.join(controller.state.directory, `${mode}.json`), 'utf8'));
      assert.equal(saved.status, 'completed');
      assert.equal(saved.actualSHA256, expectedSHA256);
      assert.equal(saved.endOfRunSHA256, expectedSHA256);
      assert.ok(saved.selectionActionMs >= saved.inspectionCompletedMs);
      assert.ok(saved.analysisCompletedMs >= saved.selectionActionMs);
      assert.deepEqual(await readFile(source), bytes);
    });
  }
  await t.test('an accidental pre-read rejects a cold-file claim and persists the failure', async () => {
    const attempt = await controller.prepare({ source, prefix: 'premature-read', mode: 'cold', expectedSHA256 });
    await readFile(attempt.file);
    await assert.rejects(controller.beforeSelection(attempt), /cache condition was not observed/);
    const saved = JSON.parse(await readFile(path.join(controller.state.directory, 'premature-read.json'), 'utf8'));
    assert.equal(saved.status, 'failed');
    assert.ok(saved.calls.at(-1).observations[0].residentPages > 0);
    assert.equal(saved.selectionActionMs, undefined);
  });
  await t.test('an existing attempt folder and its file remain unchanged', async () => {
    const folder = path.join(controller.state.directory, 'existing');
    await mkdir(folder);
    const file = path.join(folder, path.basename(source));
    await writeFile(file, 'existing successful file');
    await assert.rejects(controller.prepare({ source, prefix: 'existing', mode: 'cold', expectedSHA256 }), /EEXIST/);
    assert.equal(await readFile(file, 'utf8'), 'existing successful file');
    assert.equal(controller.state.attempts.at(-1).status, 'failed');
  });
  await t.test('verification cannot hash an input before file selection', async () => {
    const attempt = await controller.prepare({ source, prefix: 'wrong-order', mode: 'cold', expectedSHA256 });
    await assert.rejects(controller.afterAnalysis(attempt), /selected/);
    assert.equal(attempt.status, 'failed');
    assert.equal(attempt.actualSHA256, undefined);
    assert.deepEqual(attempt.calls.map(call => call.command), ['copy']);
  });
  await t.test('different selected bytes cannot finish as a successful analysis', async () => {
    const attempt = await controller.prepare({ source, prefix: 'wrong-content', mode: 'warm', expectedSHA256 });
    await controller.beforeSelection(attempt);
    controller.markSelection(attempt);
    await writeFile(attempt.file, 'changed after selection');
    await assert.rejects(controller.afterAnalysis(attempt), /Selected source bytes changed/);
    assert.equal(attempt.status, 'failed');
    assert.deepEqual(await readFile(source), bytes);
  });
  await t.test('the input must also remain unchanged after output and UI operations', async () => {
    const attempt = await controller.prepare({ source, prefix: 'modified-later', mode: 'warm', expectedSHA256 });
    await controller.beforeSelection(attempt);
    controller.markSelection(attempt);
    await readFile(attempt.file);
    await controller.afterAnalysis(attempt);
    await writeFile(attempt.file, 'changed later in the same run');
    await assert.rejects(controller.afterRun(attempt), /Selected source changed after analysis/);
    assert.equal(attempt.status, 'failed');
    assert.deepEqual(await readFile(source), bytes);
  });
});

test('partial or malformed residency is not accepted as a warm or cold file', () => {
  const complete = { bytes: 32769, pages: 3, pageBytes: 16384, residentPages: 3, monotonicMs: 123 };
  assertCacheObservation(complete, 'warm');
  assert.throws(() => assertCacheObservation({ ...complete, residentPages: 1 }, 'warm'));
  assert.throws(() => assertCacheObservation({ ...complete, residentPages: 1 }, 'cold'));
  for (const invalid of [{ pages: 2 }, { residentPages: -1 }, { residentPages: 4 }, { bytes: 0 }, { monotonicMs: NaN }]) {
    assert.throws(() => assertCacheObservation({ ...complete, ...invalid }, 'warm'));
  }
});
