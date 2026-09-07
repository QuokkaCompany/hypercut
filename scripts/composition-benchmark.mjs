import { chromium, _electron as electron } from 'playwright';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { rssSampler, summarize } from './helpers/performance.mjs';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';
import { compositionFixture, verifyCompositionAudio, verifyCompositionVideo } from './helpers/composition-performance-fixture.mjs';
import { expectedComposition, verifyCompositionSRT } from './helpers/composition-oracle.mjs';
import { verifyThresholdFrames, verifyThresholdSync } from './helpers/threshold-performance-fixture.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { capture } from '../tests/reference/server/process.mjs';
import { createFileCacheController } from './helpers/file-cache.mjs';

const exec = promisify(execFile);
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const durations = option('durations', '3600,600').split(',').map(Number);
const iterations = Number(option('iterations', '3'));
const surfaces = option('surfaces', 'browser,desktop').split(',');
const inputCache = option('input-cache', 'uncontrolled');
assert.ok(durations.every(value => [60, 600, 3600].includes(value)));
assert.ok([2, 3].includes(iterations) && surfaces.every(value => ['browser', 'desktop'].includes(value)));
assert.ok(['uncontrolled', 'cold', 'warm'].includes(inputCache), 'Unknown input-file cache condition');
const output = path.resolve(option('output', 'test-output/composition-performance'));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
assert.equal(await stat(reportPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null, 'Choose a fresh output directory');
const packagePath = 'release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar';
const report = {
  date: new Date().toISOString(), code: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(), status: 'running',
  platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, cpuCount: os.cpus().length,
  memoryBytes: os.totalmem(), node: process.version, power: (await exec('/usr/bin/pmset', ['-g', 'batt'])).stdout.trim(),
  ffmpeg: (await capture('ffmpeg', ['-version'])).split('\n')[0], requested: { durations, iterations, surfaces, inputCache, uiLocator: 'css', controlLocator: 'css with scoped native button name/state checks' },
  scope: 'Synthetic 30fps tone/flash video with manual Korean captions and 880Hz effects. Actual app import, analysis, project loading, audio reconnection, SRT/MP4/project saving, UI and render cancellation/retry. App trees sampled every 250ms including their render/verification workers. Driver and independent media verifiers excluded from RSS. Export elapsed includes application output verification; independent verification elapsed reported separately. Native file paths controlled by test. No OS cache purge, authenticated AI, speech accuracy or human audio-quality claim.',
  sourceHashes: {}, packageSourceHashes: {}, fixtures: [], runs: [], cancellations: [], failures: []
};
let cacheController;
const bundles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/"(\/assets\/[^\"]+)"/g)].map(match => `dist${match[1]}`);
assert.ok(bundles.some(file => file.endsWith('.js')));
for (const file of ['src/WindowedList.tsx', 'src/CutList.tsx', 'src/App.tsx', 'src/Captions.tsx', 'src/CaptionList.tsx', 'src/captions.css', 'src/Effects.tsx', 'server/media.mjs', 'shared/timeline.mjs', 'server/effects.mjs', 'server/caption-rendering.mjs', 'server/caption-render-worker.mjs', 'scripts/composition-benchmark.mjs', 'scripts/benchmark-server.mjs', 'scripts/helpers/composition-oracle.mjs', 'scripts/helpers/composition-performance-fixture.mjs', 'scripts/helpers/threshold-performance-fixture.mjs', 'scripts/helpers/performance.mjs', 'assets/fonts/manifest.json', 'package-lock.json', 'dist/index.html', ...bundles, packagePath]) report.sourceHashes[file] = await sha256(file);
const packagedFiles = ['server/media.mjs', 'shared/timeline.mjs', 'server/effects.mjs', 'server/caption-rendering.mjs', 'server/caption-render-worker.mjs', 'dist/index.html', ...bundles];
for (const file of ['scripts/helpers/file-cache.mjs', 'scripts/helpers/file-cache.c']) report.sourceHashes[file] = await sha256(file);
const packageHashes = JSON.parse((await exec(process.execPath, ['--input-type=module', '-e', `import {extractFile} from '@electron/asar'; import {createHash} from 'node:crypto'; const [archive, ...files] = process.argv.slice(1); console.log(JSON.stringify(Object.fromEntries(files.map(file => [file, createHash('sha256').update(extractFile(archive, file)).digest('hex')]))));`, packagePath, ...packagedFiles])).stdout);
for (const file of packagedFiles) {
  const hash = packageHashes[file];
  assert.equal(hash, report.sourceHashes[file], `Stale Mac package: ${file}`); report.packageSourceHashes[file] = hash;
}
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
// Resolve one native control without walking every caption/cut for its role.
// Validate the selected node before using the same Playwright click/save flow.
async function button(page, name) {
  const selectors = {
    '내보내기': '.header-actions > button.primary',
    '편집한 SRT 저장': '.caption-footer > button',
    '편집한 MP4 저장': '.export-ready > button',
    '작업 취소': '.job-overlay .job-foot > button'
  };
  assert.ok(Object.hasOwn(selectors, name), `Unknown control: ${name}`);
  const target = page.locator(selectors[name]);
  await target.waitFor();
  assert.deepEqual(await target.evaluate(element => ({
    tag: element.tagName, role: element.getAttribute('role') || 'button',
    name: element.getAttribute('aria-label') || element.textContent,
    labelledBy: element.getAttribute('aria-labelledby'), enabled: !element.disabled
  })), { tag: 'BUTTON', role: 'button', name, labelledBy: null, enabled: true });
  return target;
}
const cssButton = (page, name) => page.locator(`button[aria-label="${name}"]`);
const paints = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const content = ({ savedAt, ...rest }) => rest;
await copyFile('scripts/composition-benchmark.mjs', path.join(output, 'executed-benchmark.mjs'));
await copyFile('scripts/benchmark-server.mjs', path.join(output, 'executed-server.mjs'));
await flush();

async function launch(surface, directory) {
  if (surface === 'desktop') {
    const desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [`--user-data-dir=${path.join(directory, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'media') } });
    return { desktop, page: await desktop.firstWindow(), roots: [desktop.process().pid], async close() { await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await desktop.close(); } };
  }
  const backend = fork(new URL('./benchmark-server.mjs', import.meta.url), [], { env: { ...process.env, HYPERCUT_BENCHMARK_DATA_DIR: directory }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = await Promise.race([once(backend, 'message').then(([value]) => value), once(backend, 'exit').then(([code]) => { throw new Error(`Backend exited before ready: ${code}`); })]);
  const chrome = await chromium.launchServer({ channel: 'chrome', headless: true }), browser = await chromium.connect(chrome.wsEndpoint());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(ready.url);
  return { page, roots: [backend.pid, chrome.process().pid], async close() { await browser.close(); await chrome.close(); const ended = once(backend, 'exit'); backend.kill('SIGTERM'); await ended; } };
}

async function closeNotice(page) {
  if (!await page.locator('.modal-backdrop').count() && await cssButton(page, '알림 닫기').count()) await cssButton(page, '알림 닫기').click();
}
async function save(active, target, destination, notice) {
  const { page, desktop } = active; await closeNotice(page);
  if (desktop) {
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
    await target.click(); await page.getByText(notice, { exact: true }).waitFor();
  } else {
    const download = page.waitForEvent('download'); await target.click(); await (await download).saveAs(destination);
  }
}
async function saveProject(active, file) {
  await save(active, cssButton(active.page, '프로젝트 저장').first(), file, '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
  return JSON.parse(await readFile(file, 'utf8'));
}

async function measureUI(page, input) {
  const samples = [];
  async function measure(family, index, action, target, perform, check) {
    await target.scrollIntoViewIfNeeded(); const started = performance.now();
    await perform(); await check(); await paints(page);
    samples.push({ family, index, action, ms: performance.now() - started });
  }
  await cssButton(page, '전사와 자막').click();
  for (let i = 0; i < 32; i++) {
    const mode = i % 4, original = input.data.transcript.cues[1].text;
    if (mode === 0 || mode === 3) {
      const number = mode === 0 ? 2 : 1, target = cssButton(page, `자막 ${number} 선택`);
      await measure('captions', i, 'select', target, () => target.click(), () => page.waitForFunction(text => document.querySelector('textarea[aria-label="자막 문구"]')?.value === text, input.data.transcript.cues[number - 1].text));
    } else if (mode === 1) {
      const target = page.locator('textarea[aria-label="자막 문구"]');
      await measure('captions', i, 'edit', target, async () => { await target.fill(`${original} 수정`); await page.locator('.caption-fields button[type=submit]').click(); }, () => page.waitForFunction(text => document.querySelector('.caption-row.selected p')?.textContent === text && !document.querySelector('.export-ready'), `${original} 수정`));
    } else {
      const target = cssButton(page, '자막 실행 취소');
      await measure('captions', i, 'undo', target, () => target.click(), () => page.waitForFunction(text => document.querySelector('.caption-row.selected p')?.textContent === text, original));
    }
  }
  await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();
  await cssButton(page, '자막 창 닫기').click();
  await cssButton(page, '효과음 편집').click();
  for (let i = 0; i < 32; i++) {
    const mode = i % 4;
    if (mode === 0) {
      const target = page.locator('input[aria-label="효과음 음량"]');
      await measure('effects', i, 'gain', target, async () => { await target.fill('-7'); await page.locator('.effects-fields button.primary').click(); }, () => page.waitForFunction(() => document.querySelector('.effect-item.selected span')?.textContent?.includes('-7 dB') && !document.querySelector('.stale-notice')));
    } else if (mode === 2) {
      const target = page.locator('input[aria-label="효과음 음소거"]');
      await measure('effects', i, 'mute', target, async () => { await target.check(); await page.locator('.effects-fields button.primary').click(); }, () => page.waitForFunction(() => document.querySelector('.effect-item.selected small')?.textContent === '음소거' && !document.querySelector('.stale-notice')));
    } else {
      const target = cssButton(page, '효과음 실행 취소');
      await measure('effects', i, 'undo', target, () => target.click(), () => page.waitForFunction(() => document.querySelector('input[aria-label="효과음 음량"]')?.value === '-6' && !document.querySelector('input[aria-label="효과음 음소거"]')?.checked));
    }
  }
  await cssButton(page, '효과음 창 닫기').click();
  for (let i = 0; i < 32; i++) {
    const target = cssButton(page, i % 2 ? '실행 취소' : '무음 1 복원');
    await measure('cuts', i, i % 2 ? 'undo' : 'restore', target, () => target.click(), () => page.waitForFunction(count => document.querySelectorAll('.restored-row').length === count, i % 2 ? 0 : 1));
  }
  assert.equal(await page.locator('.export-ready').count(), 0);
  return { samples, byFamily: Object.fromEntries(['captions', 'effects', 'cuts'].map(family => [family, summarize(samples.filter(sample => sample.family === family).map(sample => sample.ms))])) };
}

async function exercise(surface, input) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-composition-perf-'));
  let active, sampler, phase = 'launch', iteration = 0, currentId, lastSaved, cancelled;
  const jobs = new Map(), errors = [], external = [], runResources = {};
  async function begin(name) { assert.equal(sampler, undefined); phase = name; sampler = rssSampler(active.roots); await sampler.start(); }
  async function end() {
    const memory = await sampler.stop(); sampler = undefined;
    const file = `${surface}-${Math.round(input.media.duration)}-${iteration}-${phase}-resources.json`;
    await writeFile(path.join(output, file), JSON.stringify(memory, null, 2));
    assert.deepEqual(memory.errors, []); assert.ok(memory.samples.length);
    const maxSampleGapMs = Math.max(0, ...memory.samples.slice(1).map((sample, i) => sample.milliseconds - memory.samples[i].milliseconds));
    runResources[phase] = { file, peakBytes: memory.peakBytes, samples: memory.samples.length, maxSampleGapMs };
  }
  try {
    active = await launch(surface, directory); const { page, desktop } = active; page.setDefaultTimeout(30000);
    page.on('dialog', dialog => { if (dialog.type() === 'confirm') void dialog.accept(); });
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) external.push(request.url()); });
    page.on('response', async response => { if (/\/api\/jobs\/[0-9a-f-]+$/.test(response.url()) && response.request().method() === 'GET') { const job = await response.json().catch(() => null); if (job) jobs.set(job.id, job); } });
    await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    assert.equal(await page.locator('input[role=switch][aria-label="말소리 보호"]').isChecked(), false);
    const config = await (await page.request.get(new URL('/api/config', page.url()).href)).json(), headers = { 'X-Hypercut-Token': config.token };
    async function start(type) {
      const post = page.waitForResponse(response => response.url().endsWith('/api/jobs') && response.request().method() === 'POST');
      const started = performance.now(); await (type === 'analyze' ? page.locator('.analyze-button') : await button(page, '내보내기')).click();
      const response = await post, job = await response.json(); assert.equal(response.status(), 202, JSON.stringify(job)); currentId = job.id; return started;
    }
    async function waitForState(predicate) {
      const deadline = performance.now() + Math.max(180000, input.media.duration * 1500); let lastLog = 0;
      while (performance.now() < deadline) {
        const job = jobs.get(currentId); if (job?.status === 'failed') throw new Error(job.error);
        if (job && predicate(job)) return job;
        if (job?.status === 'completed') throw new Error(`Job completed before requested state: ${phase}`);
        if (performance.now() - lastLog > 15000) { console.log(JSON.stringify({ surface, seconds: input.media.duration, iteration, phase, status: job?.status, stage: job?.stage, progress: job?.progress })); lastLog = performance.now(); }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error(`Timed out waiting for ${currentId}`);
    }
    for (iteration = 1; iteration <= iterations; iteration++) {
      for (const name of Object.keys(runResources)) delete runResources[name];
      const prefix = `${surface}-${Math.round(input.media.duration)}-${iteration}`;
      if (cacheController) phase = 'input-cache-preparation';
      const inputFileCache = cacheController ? await cacheController.prepare({ source: input.source, prefix, mode: inputCache, expectedSHA256: input.media.fingerprint }) : null;
      const selectedSource = inputFileCache?.file || input.source;
      await begin('analysis');
      if (inputFileCache) await cacheController.beforeSelection(inputFileCache);
      const analyzeStart = performance.now();
      if (inputFileCache) cacheController.markSelection(inputFileCache);
      if (desktop) { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, selectedSource); await cssButton(page, '영상 추가').click(); }
      else await page.locator('input[type=file]').first().setInputFiles(selectedSource);
      await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.job-overlay'));
      const importSeconds = (performance.now() - analyzeStart) / 1000;
      await start('analyze'); const analysis = (await waitForState(job => job.status === 'completed')).result;
      await page.waitForFunction(() => !document.querySelector('.job-overlay')); await paints(page);
      const analyzeSeconds = (performance.now() - analyzeStart) / 1000; await end();
      if (inputFileCache) { await cacheController.afterAnalysis(inputFileCache); await flush(); }
      assert.equal(analysis.cuts.length, input.expectedCuts); assert.ok(!analysis.protection?.enabled);
      assert.ok(Math.abs(analysis.decodedSamples - input.media.duration * 48000) <= 1);
      await writeFile(path.join(output, `${prefix}-analysis.json`), JSON.stringify(analysis, null, 2));
      const expected = expectedComposition(input.media.duration, analysis.cuts, input.data);
      const project = { format: 'hypercut-project', version: 7, media: { name: input.media.name, fingerprint: input.media.fingerprint, duration: input.media.duration }, settings: { ...DEFAULT_SETTINGS }, speechProtection: { enabled: false, threshold: .5 }, trackIndex: input.data.transcript.trackIndex, cuts: analysis.cuts, ...input.data, glossary: '', savedAt: '2026-09-06T00:00:00.000Z' };
      const projectFile = path.join(output, `${prefix}-input-project.json`); await writeFile(projectFile, JSON.stringify(project, null, 2));
      await begin('project-and-audio');
      await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
      await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
      await cssButton(page, '효과음 편집').click();
      const reconnect = cssButton(page, `${path.basename(input.effectFile)} 재연결`);
      if (desktop) { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, input.effectFile); await reconnect.click(); }
      else { const chooser = page.waitForEvent('filechooser'); await reconnect.click(); await (await chooser).setFiles(input.effectFile); }
      await page.locator('.effects-missing.connected').waitFor(); await cssButton(page, '효과음 창 닫기').click();
      const stored = await saveProject(active, path.join(output, `${prefix}-project.json`)); assert.deepEqual(content(stored), content(project));
      await end();
      await begin('srt'); await cssButton(page, '전사와 자막').click();
      assert.equal(Number(await page.locator('.caption-list').getAttribute('data-item-count')), expected.captions.length);
      const srtFile = path.join(output, `${prefix}.srt`);
      await save(active, await button(page, '편집한 SRT 저장'), srtFile, '편집한 자막을 저장했습니다.');
      await page.waitForFunction(() => !document.querySelector('.caption-progress'));
      const srt = verifyCompositionSRT(await readFile(srtFile, 'utf8'), expected.captions);
      await cssButton(page, '자막 창 닫기').click(); await end();
      await begin('export'); const exportStart = await start('export'), exportJob = await waitForState(job => job.status === 'completed');
      await page.waitForFunction(() => !document.querySelector('.job-overlay')); await (await button(page, '편집한 MP4 저장')).waitFor(); await paints(page);
      const exportSeconds = (performance.now() - exportStart) / 1000; await end();
      assert.equal(exportJob.result.verified, true); assert.equal(exportJob.result.burnedCaptions, expected.captions.length); assert.equal(exportJob.result.audioMix.mixedClips, expected.effects.length);
      await begin('save'); const exported = path.join(output, `${prefix}.mp4`), saveStart = performance.now();
      await save(active, await button(page, '편집한 MP4 저장'), exported, '편집한 영상을 저장했습니다.'); const saveSeconds = (performance.now() - saveStart) / 1000; await end();
      phase = 'independent-verification'; const verificationStart = performance.now();
      const video = await verifyCompositionVideo(exported, expected, path.join(output, `${prefix}-frames`));
      const audio = await verifyCompositionAudio(exported, expected), frames = await verifyThresholdFrames(input, exported, analysis.cuts);
      const sync = await verifyThresholdSync(input, exported, analysis.cuts, output), outputSHA256 = await sha256(exported);
      const independentVerificationSeconds = (performance.now() - verificationStart) / 1000;
      await writeFile(path.join(output, `${prefix}-verification.json`), JSON.stringify({ expected, video, audio, frames, sync, srt, outputSHA256, visualReview: 'NOT_RUN' }, null, 2));
      if (iteration === 2 && cancelled) cancelled.retryCompletedIteration = 2;
      lastSaved = { file: exported, sha256: outputSHA256 };
      if (iteration === 1) {
        await begin('cancel');
        await page.evaluate(() => {
          window.__compositionCancelAt = null; window.__compositionCancelFeedback = null;
          const observer = new MutationObserver(() => { if (window.__compositionCancelAt !== null && window.__compositionCancelFeedback === null && /취소/.test(document.querySelector('.job-card strong')?.textContent || document.querySelector('.notice-toast')?.textContent || '')) { window.__compositionCancelFeedback = performance.now() - window.__compositionCancelAt; observer.disconnect(); } });
          observer.observe(document.body, { subtree: true, childList: true, characterData: true });
          const click = event => { if (event.target.closest?.('button')?.textContent === '작업 취소') { window.__compositionCancelAt = performance.now(); document.removeEventListener('click', click, true); } }; document.addEventListener('click', click, true);
        });
        await start('export'); await waitForState(job => job.status === 'running' && ['자막 디자인 합성 준비', '영상 렌더링'].includes(job.stage));
        const beforeCancel = await (await page.request.get(new URL(`/api/jobs/${currentId}`, page.url()).href, { headers })).json();
        assert.equal(beforeCancel.status, 'running'); assert.ok(['자막 디자인 합성 준비', '영상 렌더링'].includes(beforeCancel.stage));
        const deletion = page.waitForResponse(response => response.url().endsWith(`/api/jobs/${currentId}`) && response.request().method() === 'DELETE');
        const cancelStart = performance.now(); await (await button(page, '작업 취소')).click(); await page.waitForFunction(() => !document.querySelector('.job-overlay'));
        const readyMs = performance.now() - cancelStart, displayMs = await page.evaluate(() => window.__compositionCancelFeedback);
        const response = await deletion; assert.equal(response.status(), 200); const body = await response.json(); assert.equal(body.cancelled, true);
        const job = await (await page.request.get(new URL(`/api/jobs/${currentId}`, page.url()).href, { headers })).json(); assert.equal(job.status, 'cancelled');
        assert.equal(await (await button(page, '내보내기')).isEnabled(), true); assert.equal(await page.locator('.export-ready').count(), 1);
        assert.deepEqual(content(await saveProject(active, path.join(output, `${prefix}-cancel-project.json`))), content(project));
        assert.equal(await sha256(exported), outputSHA256); assert.ok(displayMs !== null);
        cancelled = { surface, inputSeconds: input.media.duration, beforeCancel: { status: beforeCancel.status, stage: beforeCancel.stage, progress: beforeCancel.progress }, deleteCancelled: body.cancelled, jobStatus: job.status, readyMs, displayMs, projectPreserved: true, savedOutputPreserved: true, displayedOutputPreserved: true, displayPass: displayMs <= 300, readyPass: readyMs <= 5000, retryCompletedIteration: null };
        report.cancellations.push(cancelled); await end(); await flush();
      }
      await begin('ui'); const ui = await measureUI(page, input); await end();
      assert.deepEqual(content(await saveProject(active, path.join(output, `${prefix}-after-ui-project.json`))), content(project));
      assert.equal(await sha256(lastSaved.file), lastSaved.sha256); assert.equal(await sha256(input.source), input.media.fingerprint); assert.equal(await sha256(input.effectFile), input.effectFingerprint);
      if (inputFileCache) await cacheController.afterRun(inputFileCache);
      assert.deepEqual(errors, []); assert.deepEqual(external, []);
      const peakRSSBytes = Math.max(...Object.values(runResources).map(value => value.peakBytes));
      const result = { surface, inputSeconds: input.media.duration, iteration, cache: iteration === 1 ? 'fresh app; OS cache not purged' : 'same app; OS cache not purged', viewport: await page.evaluate(() => ({ width: innerWidth, height: innerHeight })), importSeconds, analyzeSeconds, exportSeconds, saveSeconds, independentVerificationSeconds, peakRSSBytes, resources: { ...runResources }, cuts: analysis.cuts.length, captions: expected.captions.length, effects: expected.effects.length, excludedEffects: expected.excludedEffects, output: exportJob.result, outputFile: exported, outputSHA256, srtFile, srtSHA256: await sha256(srtFile), verificationFile: `${prefix}-verification.json`, ui, sourcePreserved: true, effectPreserved: true, projectPreserved: true, pageErrors: [...errors], externalRequests: external.length, goals: { analysis: analyzeSeconds <= input.media.duration * .2, export: exportSeconds <= input.media.duration, memory: peakRSSBytes <= 2 * 1024 ** 3, ui: Object.values(ui.byFamily).every(value => value.p95 !== null && value.p95 <= 200) } };
      result.inputFileCache = inputFileCache;
      report.runs.push(result); await flush(); console.log(JSON.stringify({ surface, inputSeconds: result.inputSeconds, iteration, analyzeSeconds, exportSeconds, independentVerificationSeconds, peakRSSBytes, ui: ui.byFamily, goals: result.goals }));
      assert.ok(Object.values(result.goals).every(Boolean), 'Measured goals failed; stop before expanding repetitions');
    }
    assert.ok(cancelled?.retryCompletedIteration === 2 && cancelled.displayPass && cancelled.readyPass);
  } catch (error) {
    if (sampler) { const memory = await sampler.stop(); sampler = undefined; await writeFile(path.join(output, `${surface}-${Math.round(input.media.duration)}-${iteration}-${phase}-failed-resources.json`), JSON.stringify(memory, null, 2)); }
    report.failures.push({ surface, inputSeconds: input.media.duration, iteration, phase, job: jobs.get(currentId), error: error.stack, resources: { ...runResources }, pageErrors: errors, externalRequests: external }); await flush();
    await active?.page.screenshot({ path: path.join(output, `${surface}-${Math.round(input.media.duration)}-failure.png`), timeout: 5000 }).catch(() => {}); throw error;
  } finally { await sampler?.stop(); await active?.close(); await rm(directory, { recursive: true, force: true }); }
}

try {
  if (inputCache !== 'uncontrolled') {
    cacheController = await createFileCacheController(output);
    report.inputFileCache = cacheController.state;
    await flush();
  }
  for (const seconds of durations) {
    const input = await compositionFixture(seconds, path.join(output, `fixture-${seconds}`)); report.fixtures.push(input); await flush();
    for (const surface of surfaces) await exercise(surface, input);
  }
  report.summary = durations.flatMap(seconds => surfaces.map(surface => {
    const runs = report.runs.filter(run => run.surface === surface && run.inputSeconds === seconds);
    assert.equal(runs.length, iterations);
    return { surface, seconds, analyzeSeconds: summarize(runs.map(run => run.analyzeSeconds)), exportSeconds: summarize(runs.map(run => run.exportSeconds)), independentVerificationSeconds: summarize(runs.map(run => run.independentVerificationSeconds)), peakRSSBytes: summarize(runs.map(run => run.peakRSSBytes)) };
  }));
  report.status = 'completed'; report.measuredGoalsPass = true;
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }
finally { await flush(); }
console.log(JSON.stringify({ status: report.status, measuredGoalsPass: report.measuredGoalsPass, reportPath }));
