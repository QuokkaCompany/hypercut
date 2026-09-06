import { chromium } from 'playwright';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { rssSampler } from './helpers/performance.mjs';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';

// Diagnostic only: preserve the formal benchmark and do not force collection.
const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9) || 'test-output/editor-memory-diagnostic');
const locatorMode = process.argv.find(value => value.startsWith('--locator='))?.slice(10) || 'role';
assert.ok(['role', 'css'].includes(locatorMode));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportFile = path.join(output, 'results.json');
assert.equal(await stat(reportFile).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null, 'Choose a new output directory');
const baseline = JSON.parse(await readFile('test-output/threshold-current-v2/results.json', 'utf8'));
const input = baseline.fixtures.find(value => Math.abs(value.media.duration - 3600) < .001);
assert.ok(input); assert.equal(await sha256(input.source), input.media.fingerprint);
const report = { date: new Date().toISOString(), status: 'running', locatorMode, scope: 'Chrome UI allocation diagnostic: one 60-minute import and analysis, then three cycles of 32 restore/undo, 32 setting and 32 transport actions. No repeated import/export, no forced GC, no heap snapshot, no formal performance gate claim. CDP metrics and Playwright selectors add instrumentation cost. Locator modes retain the same native Playwright click/fill and state checks.', sourceHashes: {}, sourceFingerprint: input.media.fingerprint, snapshots: [], actions: 0, pageErrors: [], externalRequests: [] };
for (const file of ['src/App.tsx', 'src/CutList.tsx', 'src/Timeline.tsx', 'scripts/editor-memory-diagnostic.mjs', 'dist/index.html']) report.sourceHashes[file] = await sha256(file);
const flush = () => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
await flush();
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-editor-memory-'));
let backend, chrome, browser, sampler, page;
try {
  backend = fork(new URL('./benchmark-server.mjs', import.meta.url), [], { env: { ...process.env, HYPERCUT_BENCHMARK_DATA_DIR: directory }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = await Promise.race([once(backend, 'message').then(([value]) => value), once(backend, 'exit').then(([code]) => { throw new Error(`Backend exited before ready: ${code}`); })]);
  chrome = await chromium.launchServer({ channel: 'chrome', headless: true });
  browser = await chromium.connect(chrome.wsEndpoint());
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) report.externalRequests.push(request.url()); });
  await page.goto(ready.url);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const button = name => locatorMode === 'role' ? page.getByRole('button', { name, exact: true }) : page.locator(name === '원본' ? '.mode-switch button:first-child' : `button[aria-label="${name}"]`);
  const paints = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const started = performance.now();
  sampler = rssSampler([backend.pid, chrome.process().pid]); await sampler.start();
  async function snapshot(phase, cycle = 0) {
    const dom = await cdp.send('Memory.getDOMCounters');
    const metrics = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(value => [value.name, value.value]));
    const live = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length, cuts: document.querySelectorAll('.cut-row').length, restored: document.querySelectorAll('.restored-row').length, videoPaused: document.querySelector('video')?.paused ?? null }));
    const entry = { phase, cycle, milliseconds: performance.now() - started, dom, live, metrics };
    report.snapshots.push(entry); await flush();
    console.log(JSON.stringify({ phase, cycle, dom, live, heapUsedMiB: metrics.JSHeapUsedSize / 1024 ** 2, heapTotalMiB: metrics.JSHeapTotalSize / 1024 ** 2 }));
  }
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await snapshot('empty');
  await page.locator('input[type=file]').first().setInputFiles(input.source);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.job-overlay'), undefined, { timeout: 180000 });
  await snapshot('import');
  await page.locator('.analyze-button').click();
  await page.waitForFunction(() => !document.querySelector('.job-overlay') && Number(document.querySelector('.cut-list')?.dataset.itemCount) === 1000, undefined, { timeout: 180000 });
  await paints(); await snapshot('analysis');
  for (let cycle = 1; cycle <= 3; cycle++) {
    for (const family of ['restore', 'settings', 'transport']) {
      if (family === 'transport') { await button('원본').click(); await page.locator('video').evaluate(video => { video.currentTime = 0; }); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); }
      for (let i = 0; i < 32; i++) {
        const target = family === 'restore' ? button(i % 2 ? '실행 취소' : '무음 1 복원') : family === 'settings' ? (locatorMode === 'role' ? page.getByRole('spinbutton', { name: '음량 임계값', exact: true }) : page.locator('input[type=number][aria-label="음량 임계값"]')) : button(i % 2 ? '일시 정지' : '재생');
        await target.scrollIntoViewIfNeeded();
        if (family === 'settings') await target.fill(i % 2 ? '-40' : '-39'); else await target.click();
        if (family === 'restore') await page.waitForFunction(count => document.querySelectorAll('.restored-row').length === count, i % 2 ? 0 : 1);
        else if (family === 'settings') await page.waitForFunction(stale => !!document.querySelector('.stale-notice') === stale, !(i % 2));
        else await page.waitForFunction(paused => document.querySelector('video')?.paused === paused, !!(i % 2));
        await paints(); report.actions++;
      }
      await snapshot(family, cycle);
    }
  }
  await new Promise(resolve => setTimeout(resolve, 5000));
  await snapshot('idle');
  assert.equal(report.actions, 288); assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
  assert.equal(await sha256(input.source), input.media.fingerprint); report.sourcePreserved = true;
  const resources = await sampler.stop(); sampler = null;
  assert.deepEqual(resources.errors, []); await writeFile(path.join(output, 'resources.json'), JSON.stringify(resources, null, 2) + '\n');
  report.resources = { file: 'resources.json', peakBytes: resources.peakBytes, samples: resources.samples.length };
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; process.exitCode = 1;
} finally {
  if (sampler) await sampler.stop().catch(() => {});
  await flush(); await browser?.close(); await chrome?.close();
  if (backend && backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill('SIGTERM'); await ended; }
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, reportFile }));
