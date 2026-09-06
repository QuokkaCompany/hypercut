// Test-only input-file cache controls. No global cache operations or app changes.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const sourceFile = fileURLToPath(new URL('./file-cache.c', import.meta.url));
const digest = async file => {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest('hex');
};

export function assertCacheObservation(observation, mode) {
  assert.ok(['cold', 'warm'].includes(mode), 'Unknown input-file cache condition');
  for (const field of ['bytes', 'pages', 'pageBytes', 'residentPages']) {
    assert.ok(Number.isSafeInteger(observation[field]), `Invalid cache observation: ${field}`);
  }
  assert.ok(observation.bytes > 0 && observation.pageBytes > 0);
  assert.equal(observation.pages, Math.ceil(observation.bytes / observation.pageBytes));
  assert.ok(observation.residentPages >= 0 && observation.residentPages <= observation.pages);
  assert.ok(Number.isFinite(observation.monotonicMs) && observation.monotonicMs >= 0);
  assert.equal(observation.residentPages, mode === 'cold' ? 0 : observation.pages,
    `Input-file cache condition was not observed: ${mode}`);
}

export async function createFileCacheController(outputDirectory) {
  assert.equal(process.platform, 'darwin', 'File-cache controls require macOS');
  const directory = path.resolve(outputDirectory, 'input-cache');
  await mkdir(directory); // Refuse an earlier run, including a symlink at this path.
  const executedSource = path.join(directory, 'executed-file-cache.c');
  const binary = path.join(directory, 'file-cache-tool');
  await copyFile(sourceFile, executedSource);
  const compiler = (await exec('clang', ['--version'])).stdout.split('\n')[0];
  await exec('clang', ['-Wall', '-Wextra', '-Werror', '-O2', executedSource, '-o', binary]);
  const state = {
    scope: 'Cache residency of the selected source file immediately before the file-selection action. Normal import/upload remains in measured analysis time. No OS-wide, executable, storage-device, or internal working-copy cold-cache claim.',
    directory, compiler, sourceSHA256: await digest(executedSource), binarySHA256: await digest(binary),
    attempts: []
  };
  const persist = attempt => writeFile(path.join(directory, `${attempt.prefix}.json`), JSON.stringify(attempt, null, 2) + '\n');
  async function invoke(attempt, command, ...args) {
    const call = { command, startedMs: performance.now(), observations: [] };
    attempt.calls.push(call);
    try {
      const result = await exec(binary, [command, ...args], { timeout: 60000, maxBuffer: 1024 * 1024 });
      call.completedMs = performance.now();
      call.observations = result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
      assert.ok(call.observations.length, 'Missing file-cache observation');
      return call;
    } catch (error) {
      call.completedMs = performance.now();
      call.error = { message: error.message, stdout: error.stdout || '', stderr: error.stderr || '' };
      throw error;
    }
  }
  async function guarded(attempt, action) {
    try { return await action(); }
    catch (error) {
      attempt.failedStage = attempt.status;
      attempt.status = 'failed'; attempt.error = error.message;
      await persist(attempt);
      throw error;
    }
  }
  return {
    state,
    async prepare({ source, prefix, mode, expectedSHA256 }) {
      assert.match(prefix, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/);
      assert.ok(['cold', 'warm'].includes(mode));
      assert.match(expectedSHA256, /^[0-9a-f]{64}$/);
      assert.ok(!state.attempts.some(attempt => attempt.prefix === prefix), 'Duplicate cache attempt');
      const folder = path.join(directory, prefix);
      const attempt = {
        prefix, mode, source: path.resolve(source), file: path.join(folder, path.basename(source)),
        expectedSHA256, status: 'preparing', startedMs: performance.now(), calls: []
      };
      state.attempts.push(attempt);
      return guarded(attempt, async () => {
        await mkdir(folder);
        await persist(attempt);
        const copied = await invoke(attempt, 'copy', attempt.source, attempt.file);
        assert.equal(copied.observations[0].phase, 'copy_complete');
        assert.equal(copied.observations[0].method, 'F_NOCACHE_EXT');
        assert.equal(copied.observations.at(-1).phase, 'after_uncached_copy');
        if (mode === 'cold') assertCacheObservation(copied.observations.at(-1), mode);
        if (mode === 'warm') {
          const warmed = await invoke(attempt, 'warm', attempt.file);
          assert.equal(warmed.observations.at(-1).phase, 'after_cached_read');
          assertCacheObservation(warmed.observations.at(-1), mode);
        }
        attempt.status = 'prepared'; attempt.preparationMs = performance.now() - attempt.startedMs;
        await persist(attempt);
        return attempt;
      });
    },
    async beforeSelection(attempt) {
      return guarded(attempt, async () => {
        assert.equal(attempt.status, 'prepared');
        attempt.status = 'inspecting-before-selection';
        const inspected = await invoke(attempt, 'inspect', attempt.file);
        assert.equal(inspected.observations.length, 1);
        const observation = inspected.observations[0];
        assert.equal(observation.phase, 'inspect_without_read');
        assertCacheObservation(observation, attempt.mode);
        assert.equal(observation.bytes, attempt.calls[0].observations[0].bytes);
        attempt.beforeSelection = observation;
        attempt.inspectionCompletedMs = inspected.completedMs;
        attempt.status = 'ready';
        await persist(attempt);
      });
    },
    markSelection(attempt) {
      assert.equal(attempt.status, 'ready');
      attempt.selectionActionMs = performance.now();
      attempt.observationReturnToSelectionMs = attempt.selectionActionMs - attempt.inspectionCompletedMs;
      attempt.status = 'selected';
    },
    async afterAnalysis(attempt) {
      return guarded(attempt, async () => {
        assert.equal(attempt.status, 'selected');
        attempt.status = 'verifying-after-analysis';
        attempt.analysisCompletedMs = performance.now();
        const inspected = await invoke(attempt, 'inspect', attempt.file);
        assert.equal(inspected.observations.length, 1);
        attempt.afterAnalysis = inspected.observations[0];
        // Hashing must happen after the app has consumed the input and after
        // the final residency observation; it would otherwise warm the file.
        attempt.actualSHA256 = await digest(attempt.file);
        assert.equal(attempt.actualSHA256, attempt.expectedSHA256, 'Selected source bytes changed');
        attempt.status = 'completed';
        await persist(attempt);
      });
    },
    async afterRun(attempt) {
      return guarded(attempt, async () => {
        assert.equal(attempt.status, 'completed');
        attempt.status = 'verifying-after-run';
        attempt.endOfRunSHA256 = await digest(attempt.file);
        assert.equal(attempt.endOfRunSHA256, attempt.expectedSHA256, 'Selected source changed after analysis');
        attempt.status = 'completed';
        await persist(attempt);
      });
    }
  };
}
