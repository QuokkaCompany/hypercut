import { chromium, _electron as electron } from 'playwright';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { rssSampler, summarize } from './helpers/performance.mjs';
import { transcriptionFixture, sha256 } from './helpers/transcription-performance-fixture.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { validateTranscript } from '../shared/captions.mjs';
import { TRANSCRIPTION_MODEL } from '../server/transcription.mjs';
const exec = promisify(execFile);
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.split('=').slice(1).join('=') || fallback;
const durations = option('durations', '600,3600').split(',').map(Number), iterations = Number(option('iterations', '3')), surfaces = option('surfaces', 'browser,desktop').split(',');
assert.ok(durations.every(value => [60, 600, 3600].includes(value)) && [1, 2, 3].includes(iterations) && surfaces.every(value => ['browser', 'desktop'].includes(value)));
const output = path.resolve(option('output', 'test-output/transcription-performance'));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep)); await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
const report = { date: new Date().toISOString(), code: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(), workingTree: (await exec('git', ['status', '--porcelain'])).stdout.trim() ? 'modified benchmark harness; source hashes below' : 'clean', platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, cpuCount: os.cpus().length, memoryBytes: os.totalmem(), node: process.version, power: (await exec('/usr/bin/pmset', ['-g', 'batt'])).stdout.trim(), model: TRANSCRIPTION_MODEL, settings: { language: 'ko', channel: 0, cpuThreads: 4, gpu: false }, scope: 'Actual app UI + real Whisper small; repeated synthetic Korean and simple video. Union RSS of app trees sampled at 250ms, test driver excluded. No OS cache purge; unrelated desktop apps are not stopped. Selection-to-next-frame timing only, not all UI actions.', requested: { durations, iterations, surfaces }, sourceHashes: {}, fixtures: [], runs: [], cancellations: [], status: 'running' };
for (const file of ['server/transcription.mjs', 'src/Captions.tsx', 'src/App.tsx', 'scripts/transcription-benchmark.mjs', 'scripts/helpers/performance.mjs', 'scripts/helpers/transcription-performance-fixture.mjs', 'package-lock.json', '.hypercut/transcription/whisper-cli', 'release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar']) report.sourceHashes[file] = await sha256(file);
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2)); await flush();
let active;
async function launch(surface, dataDir) {
  if (surface === 'desktop') {
    const desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: dataDir } });
    const page = await desktop.firstWindow();
    return { desktop, page, roots: [desktop.process().pid], async close() { page.on('dialog', () => {}); await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await desktop.close(); } };
  }
  const backend = fork(new URL('./benchmark-server.mjs', import.meta.url), [], { env: { ...process.env, HYPERCUT_BENCHMARK_DATA_DIR: dataDir }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = await Promise.race([once(backend, 'message').then(([message]) => message), once(backend, 'exit').then(([code]) => { throw new Error(`Backend exited before ready: ${code}`); })]);
  const chrome = await chromium.launchServer({ channel: 'chrome', headless: true });
  const browser = await chromium.connect(chrome.wsEndpoint()), page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(ready.url);
  return { page, roots: [backend.pid, chrome.process().pid], async close() { await browser.close(); await chrome.close(); const ended = once(backend, 'exit'); backend.kill('SIGTERM'); await ended; } };
}
async function exercise(surface, fixture) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-stt-perf-')); let sampler;
  try {
    active = await launch(surface, directory); const { page } = active;
    page.setDefaultTimeout(30000); const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) external.push(request.url()); });
    await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    const button = name => page.getByRole('button', { name, exact: true });
    const importStart = performance.now();
    if (surface === 'desktop') { await active.desktop.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, fixture.source); await button('영상 추가').click(); }
    else await page.locator('input[type=file]').first().setInputFiles(fixture.source);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.job-overlay'), null, { timeout: 120000 }); const importSeconds = (performance.now() - importStart) / 1000;
    // Pre-existing source captions permit actual selection responsiveness and cancellation preservation checks.
    const cues = Array.from({ length: Math.min(1000, Math.floor(fixture.media.duration / 3)) }, (_, i) => ({ id: `fixture-${i}`, start: i * 3, end: i * 3 + 2, text: `기존 검토용 자막 ${i + 1}` }));
    const project = makeProject(fixture.media, DEFAULT_SETTINGS, fixture.media.audioTracks[0].index, [], undefined, { trackIndex: fixture.media.audioTracks[0].index, channel: 0, language: 'ko', model: 'synthetic prior caption fixture', cues });
    const projectPath = path.join(directory, 'project.json'); await writeFile(projectPath, JSON.stringify(project));
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await button('전사와 자막').click(); await button('다시 전사').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '다시 전사')?.disabled);
    const config = await (await page.request.get(new URL('/api/config', page.url()).href)).json(), headers = { 'X-Hypercut-Token': config.token };
    const jobs = new Map();
    page.on('response', async response => { if (/\/api\/jobs\/[0-9a-f-]+$/.test(response.url()) && response.request().method() === 'GET') { const job = await response.json().catch(() => null); if (job) jobs.set(job.id, job); } });
    let currentId;
    async function start() {
      const post = page.waitForResponse(response => response.url().endsWith('/api/jobs') && response.request().method() === 'POST');
      const started = performance.now(); await button('다시 전사').click(); const response = await post; const body = await response.json(); assert.equal(response.status(), 202, JSON.stringify(body)); currentId = body.id; return started;
    }
    async function waitForState(predicate, timeout = Math.max(180000, fixture.media.duration * 1500)) {
      const deadline = performance.now() + timeout; let lastLog = 0;
      while (performance.now() < deadline) {
        const job = jobs.get(currentId); if (job?.status === 'failed') throw new Error(job.error); if (job && predicate(job)) return job;
        if (performance.now() - lastLog > 15000) { console.log(JSON.stringify({ surface, seconds: fixture.media.duration, job: currentId, status: job?.status, stage: job?.stage, progress: job?.progress })); lastLog = performance.now(); }
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      throw new Error(`Timed out waiting for real transcription job ${currentId}`);
    }
    await page.evaluate(() => {
      window.__selectionTimes = [];
      document.addEventListener('click', event => { const row = event.target.closest?.('button.caption-row'); if (!row) return; const at = performance.now(); requestAnimationFrame(() => { window.__selectionTimes.push({ ms: performance.now() - at, selected: row.classList.contains('selected'), running: !!document.querySelector('.caption-progress') }); }); }, true);
    });
    for (let iteration = 1; iteration <= iterations; iteration++) {
      await page.evaluate(() => { window.__selectionTimes = []; }); sampler = rssSampler(active.roots); await sampler.start();
      const started = await start(); await waitForState(job => job.progress >= .15 && job.status === 'running');
      for (let i = 0; i < 32; i++) { await button(`자막 ${i % 2 ? 1 : 2} 선택`).click(); }
      const job = await waitForState(job => job.status === 'completed'); await page.waitForFunction(() => !document.querySelector('.caption-progress'));
      const elapsedSeconds = (performance.now() - started) / 1000, memory = await sampler.stop(); sampler = null;
      const values = await page.evaluate(() => window.__selectionTimes); assert.equal(values.length, 32); assert.ok(values.every(value => value.selected && value.running));
      const transcript = validateTranscript(job.result, fixture.media.duration); assert.ok(transcript.cues.length > 1); assert.ok(transcript.model.includes(TRANSCRIPTION_MODEL.sha256));
      const key = `${surface}-${Math.round(fixture.media.duration)}-${iteration}`; await writeFile(path.join(output, `${key}-resources.json`), JSON.stringify(memory, null, 2)); await writeFile(path.join(output, `${key}-transcript.json`), JSON.stringify(transcript, null, 2));
      const selection = summarize(values.map(value => value.ms));
      const result = { surface, inputSeconds: fixture.media.duration, fingerprint: fixture.media.fingerprint, iteration, cache: iteration === 1 ? 'first inference in fresh app process; OS cache not purged' : 'warm app/OS cache after previous transcription', importSeconds, elapsedSeconds, realTimeFactor: elapsedSeconds / fixture.media.duration, peakRSSBytes: memory.peakBytes, rssSamples: memory.samples.length, samplingErrors: memory.errors, selectionMs: selection, selectionRaw: values, cues: transcript.cues.length, firstCue: transcript.cues[0], lastCue: transcript.cues.at(-1), validTranscript: true, timingPass: elapsedSeconds <= fixture.media.duration, memoryPass: memory.peakBytes !== null && memory.peakBytes <= 4 * 1024 ** 3 && memory.errors.length === 0, selectionPass: selection.p95 !== null && selection.p95 <= 200, pageErrors: [...errors], externalRequests: external.length };
      report.runs.push(result); await flush(); console.log(JSON.stringify({ surface, inputSeconds: result.inputSeconds, iteration, elapsedSeconds, peakRSSBytes: memory.peakBytes, selectionP95Ms: selection.p95, cues: result.cues, timingPass: result.timingPass, memoryPass: result.memoryPass, selectionPass: result.selectionPass }));
      assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(memory.errors, []);
    }
    // Cancel only after the real engine reports inference progress, then verify a new request reaches inference.
    await start(); await waitForState(job => job.progress > .16 && job.status === 'running');
    const beforeProbe = rssSampler(active.roots); await beforeProbe.start(); const beforeResources = await beforeProbe.stop(); const enginePids = [...new Set(beforeResources.samples.flatMap(sample => sample.processes.filter(process => process.name === 'whisper-cli').map(process => process.pid)))]; assert.ok(enginePids.length, 'Actual Whisper process must be live before cancellation');
    const beforeCancelText = await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue();
    await page.evaluate(() => {
      window.__cancelDisplayMs = null;
      const observer = new MutationObserver(() => { if (window.__cancelAt !== undefined && document.querySelector('.caption-progress')?.textContent.includes('취소 중')) { window.__cancelDisplayMs = performance.now() - window.__cancelAt; observer.disconnect(); } }); observer.observe(document.body, { subtree: true, childList: true, characterData: true });
      document.addEventListener('click', event => { if (event.target.closest('button')?.textContent === '작업 취소') window.__cancelAt = performance.now(); }, { capture: true, once: true });
    });
    const cancelStart = performance.now(); await page.locator('.caption-progress').getByRole('button', { name: '작업 취소', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.caption-progress')); const cancellationMs = performance.now() - cancelStart;
    const cancelledJob = await (await page.request.get(new URL(`/api/jobs/${currentId}`, page.url()).href, { headers })).json(); assert.equal(cancelledJob.status, 'cancelled'); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), beforeCancelText); assert.equal(await button('다시 전사').isEnabled(), true);
    const afterProbe = rssSampler(active.roots); await afterProbe.start(); const afterResources = await afterProbe.stop(); assert.ok(afterResources.samples.every(sample => sample.processes.every(process => !enginePids.includes(process.pid))), 'Cancelled Whisper must have exited');
    const cancelDisplayMs = await page.evaluate(() => window.__cancelDisplayMs); assert.ok(cancelDisplayMs !== null);
    await start(); await waitForState(job => job.progress > .16 && job.status === 'running'); await page.locator('.caption-progress').getByRole('button', { name: '작업 취소', exact: true }).click(); await page.waitForFunction(() => !document.querySelector('.caption-progress'));
    report.cancellations.push({ surface, inputSeconds: fixture.media.duration, jobStatus: cancelledJob.status, displayMs: cancelDisplayMs, readyMs: cancellationMs, originalCaptionPreserved: true, realEngineProcessExited: true, retryAcceptedAndReachedInference: true, displayPass: cancelDisplayMs <= 300, readyPass: cancellationMs <= 5000 }); await flush();
  } finally { await sampler?.stop(); await active?.close(); active = undefined; await rm(directory, { recursive: true, force: true }); }
}
try {
  for (const seconds of durations) {
    const fixture = await transcriptionFixture(path.resolve('test-output/transcription-performance-fixtures'), seconds); report.fixtures.push({ ...fixture, source: path.relative(process.cwd(), fixture.source) }); await flush();
    for (const surface of surfaces) await exercise(surface, fixture);
  }
  report.status = 'completed'; report.summary = [];
  for (const seconds of durations) for (const surface of surfaces) { const runs = report.runs.filter(run => run.surface === surface && Math.abs(run.inputSeconds - seconds) < 1); report.summary.push({ surface, seconds, elapsedSeconds: summarize(runs.map(run => run.elapsedSeconds)), peakRSSBytes: summarize(runs.map(run => run.peakRSSBytes)), allMeasuredGoalsPass: runs.every(run => run.timingPass && run.memoryPass && run.selectionPass) }); }
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally { await flush(); }
console.log(JSON.stringify({ status: report.status, reportPath, summary: report.summary }));
