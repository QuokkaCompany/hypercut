import { chromium, _electron as electron } from 'playwright';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { extractFile } from '@electron/asar';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { transcriptionRuntime, TRANSCRIPTION_MODEL } from '../server/transcription.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { speechFixture } from '../tests/helpers/speech-fixture.mjs';

const output = path.resolve(process.argv.find(x => x.startsWith('--output='))?.slice(9) || `test-output/transcription-readiness-${Date.now()}`);
await mkdir(output);
const archive = path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar');
const report = { date: new Date().toISOString(), status: 'running', scope: 'Actual Chrome and packaged Mac readiness API, missing runtime recovery via test-owned symlinks, manual caption preservation and actual Whisper inference on Korean TTS. Native dialog paths controlled by test. No external model/account, human-quality, first-install or performance claim.', sourceHashes: {}, packageSourceHashes: {}, runs: [] };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const bundles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/"(\/assets\/[^\"]+)"/g)].map(match => `dist${match[1]}`);
assert.ok(bundles.some(f => f.endsWith('.js')));
for (const f of ['src/Captions.tsx', 'src/App.tsx', 'server/app.mjs', 'server/transcription.mjs', 'server/process.mjs', 'shared/timeline.mjs', 'dist/index.html', ...bundles]) {
  report.sourceHashes[f] = hash(await readFile(f)); report.packageSourceHashes[f] = hash(extractFile(archive, f));
  assert.equal(report.sourceHashes[f], report.packageSourceHashes[f], `Stale package: ${f}`);
}
for (const f of ['scripts/transcription-readiness-e2e.mjs', 'tests/helpers/speech-fixture.mjs', 'package-lock.json']) report.sourceHashes[f] = hash(await readFile(f));
report.sourceHashes[path.relative(process.cwd(), archive)] = hash(await readFile(archive));
await writeFile(path.join(output, 'executed-runner.mjs'), await readFile(import.meta.filename));
const installedBrowserRuntime = transcriptionRuntime(), previousRuntime = process.env.HYPERCUT_TRANSCRIPTION_DIR;
const button = (page, name) => page.getByRole('button', { name, exact: true });
let browser, desktop, server;
try {
  const fixture = await speechFixture(path.join(output, 'fixture')), media = await inspectMedia(fixture.video);
  const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: 'original', start: 1, end: 2, text: '기존 자막' }] };
  const initial = makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 0, end: .2, enabled: true, reason: 'manual' }], undefined, transcript);
  const projectFile = path.join(output, 'initial.json'); await writeFile(projectFile, JSON.stringify(initial));
  report.fixture = { mediaSHA256: hash(await readFile(fixture.video)), spoken: fixture.spoken, text: fixture.text };
  async function exercise(page, surface, runtime, installedRuntime) {
    const errors = [], external = [], statuses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) external.push(request.url()); });
    page.on('dialog', dialog => { void dialog.accept().catch(() => {}); });
    async function checkStatus(action) {
      const response = page.waitForResponse(r => r.url().endsWith('/api/transcription/status'));
      await action(); const received = await response; assert.equal(received.status(), 200);
      const status = await received.json(); statuses.push(status); return status;
    }
    const openCaptions = () => checkStatus(() => button(page, '전사와 자막').click());
    await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture.video); await button(page, '영상 추가').click(); }
    else await page.locator('input[type=file]').first().setInputFiles(fixture.video);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.project-open')?.disabled);
    await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
    await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
    await openCaptions();
    const panel = page.getByRole('dialog', { name: '전사와 자막 편집', exact: true });
    await panel.locator('.caption-engine').filter({ hasText: '전사 엔진을 찾을 수 없습니다' }).waitFor();
    assert.equal(statuses.at(-1).reason, 'engine-missing'); assert.equal(await button(panel, '다시 전사').isDisabled(), true);
    const corrected = '모델 없이 수정한 자막'; await panel.getByRole('textbox', { name: '자막 문구', exact: true }).fill(corrected); await button(panel, '자막 수정 적용').click();
    const edited = { ...initial, transcript: { ...transcript, cues: [{ ...transcript.cues[0], text: corrected }] } };
    async function save(name, expected) {
      await button(panel, '자막 창 닫기').click(); const file = path.join(output, `${surface}-${name}.json`);
      if (await button(page, '알림 닫기').count()) await button(page, '알림 닫기').click();
      await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor({ state: 'hidden' });
      if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await button(page, '프로젝트 저장').first().click(); await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor(); }
      else { const download = page.waitForEvent('download'); await button(page, '프로젝트 저장').first().click(); await (await download).saveAs(file); }
      const stored = JSON.parse(await readFile(file, 'utf8')); assert.deepEqual(stored, { ...expected, savedAt: stored.savedAt });
      await openCaptions(); return stored;
    }
    await save('while-unavailable', edited);
    await panel.locator('.caption-engine').filter({ hasText: '전사 엔진을 찾을 수 없습니다' }).waitFor();
    await symlink(path.join(installedRuntime, 'whisper-cli'), path.join(runtime, 'whisper-cli'));
    await checkStatus(() => button(panel, '다시 확인').click()); await panel.locator('.caption-engine').filter({ hasText: '음성 인식 모델을 찾을 수 없습니다' }).waitFor();
    assert.equal(statuses.at(-1).reason, 'model-missing'); assert.equal(await button(panel, '다시 전사').isDisabled(), true);
    assert.equal(await panel.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), corrected);
    await symlink(path.join(installedRuntime, TRANSCRIPTION_MODEL.file), path.join(runtime, TRANSCRIPTION_MODEL.file));
    await checkStatus(() => button(panel, '다시 확인').click()); await panel.locator('.caption-engine').filter({ hasText: '인터넷 없이 전사' }).waitFor();
    assert.equal(statuses.at(-1).ready, true); assert.equal(statuses.at(-1).integrity, 'checked-at-transcription');
    assert.equal(await button(panel, '다시 전사').isEnabled(), true);
    const completed = page.waitForResponse(async response => {
      if (!/\/api\/jobs\/[0-9a-f-]+$/.test(response.url()) || response.request().method() !== 'GET') return false;
      const job = await response.json(); return job.type === 'transcribe' && job.status !== 'running';
    }, { timeout: 120000 });
    await button(panel, '다시 전사').click();
    const job = await (await completed).json(); assert.equal(job.status, 'completed', job.error); const inferred = job.result;
    await page.waitForFunction(() => document.querySelectorAll('.caption-row').length === 2 && ![...document.querySelectorAll('button')].find(b => b.textContent === '다시 전사')?.disabled, undefined, { timeout: 120000 });
    assert.ok(inferred?.cues.length === 2); assert.match(inferred.cues.map(c => c.text).join(''), /작은 목소리/);
    assert.ok(inferred.cues.every(c => c.start >= 0 && c.end <= media.duration));
    await button(panel, '자막 실행 취소').click(); await page.waitForFunction(text => document.querySelector('[aria-label="자막 문구"]')?.value === text, corrected);
    await save('undo-after-recovery', edited);
    await panel.locator('.caption-engine').filter({ hasText: '인터넷 없이 전사' }).waitFor();
    await button(panel, '자막 다시 실행').click(); await page.waitForFunction(() => document.querySelectorAll('.caption-row').length === 2);
    const final = await save('recovered', { ...initial, transcript: inferred });
    await button(panel, '자막 창 닫기').click(); await page.locator('input[type=file]').nth(1).setInputFiles(path.join(output, `${surface}-recovered.json`));
    await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
    await openCaptions(); await page.waitForFunction(() => document.querySelectorAll('.caption-row').length === 2);
    await panel.locator('.caption-engine').filter({ hasText: '인터넷 없이 전사' }).waitFor();
    assert.equal(hash(await readFile(fixture.video)), report.fixture.mediaSHA256); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    report.runs.push({ surface, status: 'PASS', statuses, actualTranscript: inferred, savedProjectVersion: final.version, manualEditAndSaveWithoutModel: true, retryAfterEngineAndModelRecovery: true, actualWhisperInference: true, undoRedoAndFullProjectPreservation: true, sourcePreserved: true, errors, externalPageRequests: external });
    console.log(JSON.stringify({ surface, status: 'PASS', readinessRecovery: true, manualEditsPreserved: true, actualInferenceCues: inferred.cues.length }));
  }
  const webRuntime = path.join(output, 'web-runtime'); await mkdir(webRuntime); process.env.HYPERCUT_TRANSCRIPTION_DIR = webRuntime;
  server = await startServer({ port: 0, dataDir: path.join(output, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await exercise(page, 'browser', webRuntime, installedBrowserRuntime); await browser.close(); browser = null; await server.close(); server = null;
  if (previousRuntime === undefined) delete process.env.HYPERCUT_TRANSCRIPTION_DIR; else process.env.HYPERCUT_TRANSCRIPTION_DIR = previousRuntime;
  if (process.argv.includes('--desktop')) {
    const runtime = path.join(output, 'desktop-runtime'); await mkdir(runtime);
    desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(output, 'desktop'), HYPERCUT_TRANSCRIPTION_DIR: runtime } });
    page = await desktop.firstWindow(); await exercise(page, 'desktop', runtime, path.join(path.dirname(archive), 'transcription'));
  }
  report.status = 'completed';
} catch (error) { report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally {
  const intendedStatus = report.status; report.status = 'cleanup_pending';
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  try {
    if (desktop) {
      await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {});
      const closing = desktop.close(); let timer;
      try { await Promise.race([closing, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Test desktop cleanup timed out')), 10000); })]); }
      catch (error) { desktop.process().kill('SIGKILL'); await closing.catch(() => {}); throw error; }
      finally { clearTimeout(timer); }
    }
    await browser?.close(); await server?.close(); report.status = intendedStatus;
  } catch (error) { report.status = 'failed'; report.cleanupError = error.stack; process.exitCode = 1; }
  finally {
    if (previousRuntime === undefined) delete process.env.HYPERCUT_TRANSCRIPTION_DIR; else process.env.HYPERCUT_TRANSCRIPTION_DIR = previousRuntime;
    await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2));
  }
}
console.log(JSON.stringify({ status: report.status, output }));
