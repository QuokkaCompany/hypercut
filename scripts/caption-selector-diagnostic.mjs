import { chromium } from 'playwright';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';
import { rssSampler, summarize } from './helpers/performance.mjs';

const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const mode = option('mode', 'queries'), releaseMedia = process.argv.includes('--release-media');
assert.ok(['queries', 'lifecycle'].includes(mode));
assert.ok(!releaseMedia || mode === 'lifecycle');
const selector = option('selector', 'role'), output = path.resolve(option('output', 'test-output/caption-selector-diagnostic'));
assert.ok(['role', 'css'].includes(selector)); assert.ok(mode !== 'lifecycle' || selector === 'css'); assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportFile = path.join(output, 'results.json'); await writeFile(reportFile, '', { flag: 'wx' });
const inputDirectory = path.resolve('test-output/composition-contained-long/browser-long');
const input = JSON.parse(await readFile(path.join(inputDirectory, 'fixture-3600/composition-fixture.json'), 'utf8'));
const projectFile = path.join(inputDirectory, 'browser-3600-1-input-project.json'), project = JSON.parse(await readFile(projectFile, 'utf8'));
assert.ok(input.source.startsWith(path.resolve('test-output') + path.sep)); assert.equal(await sha256(input.source), input.media.fingerprint);
const report = { date: new Date().toISOString(), status: 'running', selector, mode, releaseMedia, lifecycleCycles: [], scope: 'Read-only locator diagnostic: one real 60-minute analysis then a 1000-cue project. Three groups of 32 queries target the same enabled SRT button, without clicking it or editing. All app process trees are sampled during the queries. Driver excluded. No export, forced GC, browser restart, heap snapshot or performance gate claim. Backend heap/RSS comes through this test server parent IPC only.', sourceHashes: {}, snapshots: [], queryGroups: [], pageErrors: [] };
if (mode === 'lifecycle') report.scope = 'Lifecycle diagnostic: one real 60-minute analysis, one 1000-cue project, six native close/reopen cycles and cue-2 seeks. Optional explicit pause/src removal/load applies only to the test page video immediately before its actual close click. No editing, export, forced GC or browser restart. All owned app processes measured. Full project compared after. Not a formal performance or memory-leak claim.';
const bundles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/"(\/assets\/[^\"]+)"/g)].map(match => `dist${match[1]}`);
for (const file of ['src/App.tsx', 'src/Captions.tsx', 'src/CaptionList.tsx', 'src/captions.css', 'server/app.mjs', 'scripts/benchmark-server.mjs', 'scripts/caption-selector-diagnostic.mjs', 'scripts/helpers/performance.mjs', 'node_modules/playwright/package.json', 'package-lock.json', 'dist/index.html', ...bundles, input.source, projectFile]) report.sourceHashes[file] = await sha256(file);
await copyFile('scripts/caption-selector-diagnostic.mjs', path.join(output, 'executed.mjs'));
await copyFile('scripts/benchmark-server.mjs', path.join(output, 'executed-server.mjs'));
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-caption-selector-'));
let backend, browser, sampler;
try {
  backend = fork(new URL('./benchmark-server.mjs', import.meta.url), [], { env: { ...process.env, HYPERCUT_BENCHMARK_DATA_DIR: directory }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = await Promise.race([once(backend, 'message').then(([value]) => value), once(backend, 'exit').then(([code]) => { throw new Error(`Backend exited ${code}`); })]);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('dialog', dialog => { if (dialog.type() === 'confirm') void dialog.accept(); });
  await page.goto(ready.url);
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(input.source);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.job-overlay'));
  await page.locator('.analyze-button').click();
  await page.waitForFunction(() => Number(document.querySelector('.cut-list')?.dataset.itemCount) === 1000 && !document.querySelector('.job-overlay'), undefined, { timeout: 120000 });
  await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
  await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
  const button = name => page.locator(`button[aria-label="${name}"]`);
  if (await button('알림 닫기').count()) await button('알림 닫기').click();
  async function openCaptions() {
    await button('전사와 자막').click();
    await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();
    await page.waitForFunction(() => {
      const video = document.querySelector('.caption-source video');
      return video?.textTracks[0]?.cues?.length === 1000 && video.readyState >= 2 && !video.seeking;
    });
    assert.equal(Number(await page.locator('.caption-list').getAttribute('data-item-count')), 1000);
  }
  await openCaptions();
  assert.equal(await page.locator('.audio-track svg rect').count(), 600);
  const browserCDP = await browser.newBrowserCDPSession(), cdp = await page.context().newCDPSession(page);
  const roots = (await browserCDP.send('SystemInfo.getProcessInfo')).processInfo.filter(process => process.type === 'browser');
  assert.equal(roots.length, 1); report.roots = [backend.pid, roots[0].id];
  await cdp.send('Performance.enable');
  const query = selector === 'role' ? page.getByRole('button', { name: '편집한 SRT 저장', exact: true }) : page.locator('.caption-footer > button');
  async function backendMemory() {
    const id = String(report.snapshots.length);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { backend.off('message', listener); reject(new Error('Backend memory snapshot timed out')); }, 5000);
      const listener = message => { if (message?.type === 'memory-snapshot' && message.id === id) { clearTimeout(timer); backend.off('message', listener); resolve(message.memory); } };
      backend.on('message', listener); backend.send({ type: 'memory-snapshot', id });
    });
  }
  async function snapshot(phase) {
    const dom = await cdp.send('Memory.getDOMCounters'), heap = await cdp.send('Runtime.getHeapUsage');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
    const live = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, captions: document.querySelectorAll('.caption-row').length, cuts: document.querySelectorAll('.cut-row').length }));
    report.snapshots.push({ phase, dom, heap, metrics, live, backend: await backendMemory() });
  }
  sampler = rssSampler(report.roots); await sampler.start(); await snapshot('before');
  if (mode === 'queries') {
    for (let group = 1; group <= 3; group++) {
      const times = [];
      for (let i = 0; i < 32; i++) {
        const start = performance.now();
        const result = await query.evaluate(element => ({ text: element.textContent, enabled: !element.disabled, footer: element.parentElement.classList.contains('caption-footer') }));
        times.push(performance.now() - start);
        assert.deepEqual(result, { text: '편집한 SRT 저장', enabled: true, footer: true });
      }
      report.queryGroups.push({ group, samplesMs: times, summary: summarize(times) }); await snapshot(`queries-${group}`);
    }
  } else {
    for (let cycle = 1; cycle <= 6; cycle++) {
      await button('자막 2 선택').click();
      const cue = project.transcript.cues[1];
      await page.waitForFunction(({ start, text }) => {
        const video = document.querySelector('.caption-source video');
        return video && Math.abs(video.currentTime - start) < .001 && video.readyState >= 2 && !video.seeking && document.querySelector('textarea[aria-label="자막 문구"]')?.value === text;
      }, { start: cue.start, text: cue.text });
      await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();
      await snapshot(`seek-${cycle}`);
      const before = await page.locator('.caption-source video').evaluate(video => ({ time: video.currentTime, duration: video.duration, cues: video.textTracks[0].cues.length }));
      assert.equal(before.cues, 1000);
      if (releaseMedia) await page.locator('.caption-source video').evaluate(video => { video.pause(); video.removeAttribute('src'); video.load(); });
      await button('자막 창 닫기').click();
      await page.waitForFunction(() => !document.querySelector('.caption-modal'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(await page.locator('.caption-source video').count(), 0);
      await snapshot(`closed-${cycle}`);
      await openCaptions();
      assert.equal(await page.locator('textarea[aria-label="자막 문구"]').inputValue(), project.transcript.cues[0].text);
      await snapshot(`reopened-${cycle}`);
      report.lifecycleCycles.push({ cycle, before, closed: true, reopenedCues: 1000, firstCaptionRestored: true });
    }
    await page.screenshot({ path: path.join(output, 'reopened-captions.png') });
  }
  const resources = await sampler.stop(); sampler = undefined;
  assert.deepEqual(resources.errors, []); await writeFile(path.join(output, 'resources.json'), JSON.stringify(resources, null, 2));
  report.resources = { peakBytes: resources.peakBytes, samples: resources.samples.length, sampleIntervalMs: resources.sampleIntervalMs };
  await button('자막 창 닫기').click();
  const download = page.waitForEvent('download'); await button('프로젝트 저장').first().click();
  const saved = path.join(output, 'after-project.json'); await (await download).saveAs(saved);
  const content = ({ savedAt, ...rest }) => rest;
  assert.deepEqual(content(JSON.parse(await readFile(saved, 'utf8'))), content(project));
  assert.deepEqual(report.pageErrors, []); report.projectPreserved = true; report.status = 'completed';
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }
finally {
  if (sampler) await sampler.stop().catch(() => {});
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (backend && backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill('SIGTERM'); await ended; }
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, selector, mode, releaseMedia, reportFile, peakGiB: report.resources?.peakBytes / 1024 ** 3, error: report.error }));
