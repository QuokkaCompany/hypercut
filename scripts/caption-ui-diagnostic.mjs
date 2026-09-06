import { chromium } from 'playwright';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';
import { summarize } from './helpers/performance.mjs';

const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const inputDirectory = path.resolve(option('input', 'test-output/composition-long-candidate/browser-long'));
const output = path.resolve(option('output', 'test-output/caption-ui-diagnostic'));
const sourcePreview = option('source-preview', 'normal');
assert.ok(['normal', 'none'].includes(sourcePreview));
const analyze = process.argv.includes('--analyze'), backdrop = option('backdrop', 'normal');
assert.ok(['normal', 'flat'].includes(backdrop));
const nativeSample = process.argv.includes('--native-sample');
const rowRendering = option('row-rendering', 'normal');
assert.ok(['normal', 'auto'].includes(rowRendering));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportFile = path.join(output, 'results.json');
await writeFile(reportFile, '', { flag: 'wx' });
const input = JSON.parse(await readFile(path.join(inputDirectory, 'fixture-3600/composition-fixture.json'), 'utf8'));
const projectFile = path.join(inputDirectory, 'browser-3600-1-input-project.json');
const project = JSON.parse(await readFile(projectFile, 'utf8'));
const report = { date: new Date().toISOString(), status: 'running', sourcePreview, analyze, backdrop, nativeSample, rowRendering, scope: 'Diagnostic only: same 60-minute source and saved 1000-cue project; optional real analysis; export and cancellation omitted. Native clicks and input, CDP performance/trace and input-to-two-animation-frames observations. Optional native sampling targets only renderers of the browser launched by this script. The optional none control replaces source VTT blobs with empty valid tracks; flat disables modal backdrop blur; auto uses content-visibility for offscreen caption rows. Not a formal performance pass.', sourceHashes: {}, samples: [], pageErrors: [] };
const bundles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/"(\/assets\/[^\"]+)"/g)].map(match => `dist${match[1]}`);
for (const file of ['src/Captions.tsx', 'src/CaptionList.tsx', 'src/CaptionStyle.tsx', 'src/captions.css', 'scripts/caption-ui-diagnostic.mjs', 'dist/index.html', ...bundles, input.source, projectFile]) report.sourceHashes[file] = await sha256(file);
await copyFile('scripts/caption-ui-diagnostic.mjs', path.join(output, 'executed.mjs'));
assert.equal(await sha256(input.source), input.media.fingerprint);
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-caption-ui-'));
let backend, browser, cdp, tracing = false, sampling;
const trace = [];
try {
  backend = fork(new URL('./benchmark-server.mjs', import.meta.url), [], { env: { ...process.env, HYPERCUT_BENCHMARK_DATA_DIR: directory }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  const ready = await Promise.race([once(backend, 'message').then(([value]) => value), once(backend, 'exit').then(([code]) => { throw new Error(`Backend exited ${code}`); })]);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  if (sourcePreview === 'none') await page.addInitScript(() => {
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = value => original(value instanceof Blob && value.type === 'text/vtt' ? new Blob(['WEBVTT\n\n'], { type: 'text/vtt' }) : value);
  });
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('dialog', dialog => { if (dialog.type() === 'confirm') void dialog.accept(); });
  await page.goto(ready.url);
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(input.source);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.job-overlay'));
  if (analyze) {
    await page.locator('.analyze-button').click();
    await page.waitForFunction(() => Number(document.querySelector('.cut-list')?.dataset.itemCount) === 1000 && !document.querySelector('.job-overlay'), undefined, { timeout: 120000 });
    assert.equal(await page.locator('.audio-track svg rect').count(), 600);
  }
  await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
  await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
  if (backdrop === 'flat') await page.addStyleTag({ content: '.modal-backdrop { backdrop-filter: none; }' });
  if (rowRendering === 'auto') {
    assert.ok(await page.evaluate(() => CSS.supports('content-visibility', 'auto')));
    await page.addStyleTag({ content: '.caption-row { content-visibility: auto; contain-intrinsic-size: auto 115px; }' });
  }
  const button = name => page.locator(`button[aria-label="${name}"]`);
  await button('전사와 자막').click();
  assert.equal(Number(await page.locator('.caption-list').getAttribute('data-item-count')), 1000);
  cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  cdp.on('Tracing.dataCollected', event => trace.push(...event.value));
  await cdp.send('Tracing.start', { categories: 'toplevel,devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' }); tracing = true;
  await page.evaluate(() => {
    window.__captionDiagnostic = [];
    for (const type of ['click', 'input', 'submit']) document.addEventListener(type, event => {
      const start = performance.now(), target = event.target.closest?.('button,input,textarea,form');
      if (!target?.closest('.caption-modal')) return;
      const label = target.getAttribute('aria-label') || target.textContent?.slice(0, 40), index = window.__captionDiagnosticIndex;
      requestAnimationFrame(() => requestAnimationFrame(() => window.__captionDiagnostic.push({ index, type, label, paintMs: performance.now() - start, text: document.querySelector('textarea[aria-label="자막 문구"]')?.value })));
    }, true);
  });
  const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]));
  if (nativeSample) {
    const browserCDP = await browser.newBrowserCDPSession();
    const processes = (await browserCDP.send('SystemInfo.getProcessInfo')).processInfo.filter(process => process.type === 'renderer');
    await page.evaluate(() => performance.mark('hypercut-caption-renderer-identity'));
    const identified = once(cdp, 'Tracing.tracingComplete'); await cdp.send('Tracing.end'); await identified; tracing = false;
    const renderer = trace.find(event => event.name === 'hypercut-caption-renderer-identity')?.pid;
    assert.ok(processes.some(process => process.id === renderer), 'The page marker must identify a renderer of this owned browser');
    report.ownedRenderers = processes; report.sampledRenderer = renderer;
    await cdp.send('Tracing.start', { categories: 'toplevel,devtools.timeline,blink.user_timing', transferMode: 'ReportEvents' }); tracing = true;
    sampling = promisify(execFile)('/usr/bin/sample', [String(renderer), '10', '1', '-file', path.join(output, 'renderer-sample.txt')], { maxBuffer: 1024 ** 2 }).then(result => { report.nativeSampleOutput = result.stdout + result.stderr; }, error => { report.nativeSampleError = error.message; });
  }
  for (let i = 0; i < 32; i++) {
    const mode = i % 4, number = mode === 0 ? 2 : 1, original = project.transcript.cues[1].text;
    const target = mode === 0 || mode === 3 ? button(`자막 ${number} 선택`) : mode === 1 ? page.locator('textarea[aria-label="자막 문구"]') : button('자막 실행 취소');
    await target.scrollIntoViewIfNeeded();
    await page.evaluate(index => { window.__captionDiagnosticIndex = index; performance.mark(`caption-${index}-start`); }, i);
    const before = await metrics(), start = performance.now(); let filledMs;
    if (mode === 1) { await target.fill(`${original} 수정`); filledMs = performance.now() - start; await page.locator('.caption-fields button[type=submit]').click(); }
    else await target.click();
    const performedMs = performance.now() - start;
    const expected = mode === 1 ? `${original} 수정` : mode === 2 ? original : project.transcript.cues[number - 1].text;
    await page.waitForFunction(({ text, row }) => row ? document.querySelector('.caption-row.selected p')?.textContent === text : document.querySelector('textarea[aria-label="자막 문구"]')?.value === text, { text: expected, row: mode === 1 || mode === 2 });
    const checkedMs = performance.now() - start;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const totalMs = performance.now() - start, after = await metrics();
    await page.evaluate(index => performance.mark(`caption-${index}-end`), i);
    report.samples.push({ index: i, action: mode === 1 ? 'edit' : mode === 2 ? 'undo' : 'select', filledMs, performedMs, checkedMs, totalMs, metricsDelta: Object.fromEntries(['TaskDuration', 'ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'LayoutCount', 'RecalcStyleCount'].map(key => [key, after[key] - before[key]])) });
  }
  const complete = once(cdp, 'Tracing.tracingComplete'); await cdp.send('Tracing.end'); await complete; tracing = false;
  report.events = await page.evaluate(() => window.__captionDiagnostic);
  report.summary = summarize(report.samples.map(sample => sample.totalMs));
  assert.equal(Number(await page.locator('.caption-list').getAttribute('data-item-count')), 1000);
  await page.screenshot({ path: path.join(output, 'caption-editor.png') });
  await button('자막 창 닫기').click();
  const download = page.waitForEvent('download'); await button('프로젝트 저장').first().click();
  const saved = path.join(output, 'after-project.json'); await (await download).saveAs(saved);
  const content = ({ savedAt, ...rest }) => rest;
  assert.deepEqual(content(JSON.parse(await readFile(saved, 'utf8'))), content(project));
  assert.deepEqual(report.pageErrors, []); report.fullProjectPreserved = true; report.status = 'completed';
} catch (error) { report.error = error.stack; report.status = 'failed'; process.exitCode = 1; }
finally {
  await sampling;
  if (tracing) { const complete = once(cdp, 'Tracing.tracingComplete'); await cdp.send('Tracing.end'); await complete; }
  await writeFile(path.join(output, 'trace.json'), JSON.stringify({ traceEvents: trace }));
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  await browser?.close();
  if (backend && backend.exitCode === null) { const ended = once(backend, 'exit'); backend.kill('SIGTERM'); await ended; }
  await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, reportFile, summary: report.summary, error: report.error }));
