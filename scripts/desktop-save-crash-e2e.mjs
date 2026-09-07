import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { generateDemo } from './fixtures.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
import { processTreeRSS } from './helpers/performance.mjs';

if (process.platform !== 'darwin') throw new Error('This test requires the packaged macOS app.');
const exec = promisify(execFile), packageRoot = path.resolve('release/HyperCut-darwin-arm64/HyperCut.app');
const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-output/desktop-save-crash');
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
if (await readFile(reportPath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Results already exist; use a new --output directory.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-app-save-crash-'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const content = project => { const { savedAt, ...rest } = validateProject(project); return rest; };
const report = { date: new Date().toISOString(), status: 'running', code: (await exec('git', ['rev-parse', 'HEAD'])).stdout.trim(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, harnessSHA256: digest(await readFile(new URL(import.meta.url))), packageSHA256: digest(await readFile(path.join(packageRoot, 'Contents/Resources/app.asar'))), scope: 'Real packaged Mac UI/IPC/atomic save. Test-only rename boundary barrier, native path picker redirected to disposable files. Full main-process SIGKILL and fresh app reopen. No power-loss or native overwrite-confirmation claim.', runs: [] };
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await flush();
let desktop, sequence = 0, ownedProcesses = [];
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function snapshot() { return (await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm='], { maxBuffer: 4 * 1024 ** 2 })).stdout; }
async function until(check, description, timeout = 10000) {
  const deadline = performance.now() + timeout;
  while (performance.now() < deadline) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error(`Timed out: ${description}`);
}
async function launch() {
  const dataDir = path.join(directory, `app-${++sequence}`), errors = [], external = [];
  desktop = await electron.launch({ executablePath: path.join(packageRoot, 'Contents/MacOS/HyperCut'), args: [`--user-data-dir=${path.join(dataDir, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(dataDir, 'media') } });
  const page = await desktop.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) external.push(request.url()); });
  // Electron owns beforeunload through its native handler; Playwright must not also dismiss it.
  page.on('dialog', () => {});
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  const security = await desktop.evaluate(({ BrowserWindow }) => { const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences(); return { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity }; });
  assert.deepEqual(security, { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true });
  return { page, errors, external, security };
}
async function open(page, projectFile, video) {
  await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
  await button(page, '원본 선택 →').waitFor();
  await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video);
  await button(page, '원본 선택 →').click();
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.pending-project'));
  assert.equal(await page.locator('.unsaved-dot').count(), 0);
}
async function chooseSave(target) {
  await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, target);
}
async function save(page, target) {
  await chooseSave(target); await button(page, '프로젝트 저장').first().click();
  await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor();
  await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
  await button(page, '알림 닫기').click();
  return validateProject(JSON.parse(await readFile(target, 'utf8')));
}
async function arm(target, phase) {
  await desktop.evaluate((_, options) => {
    const fs = process.getBuiltinModule('fs/promises');
    const { syncBuiltinESMExports } = process.getBuiltinModule('module');
    const rename = fs.rename;
    globalThis.saveCrashBarrier = null;
    fs.rename = async (from, to) => {
      if (to !== options.target) return rename(from, to);
      if (options.phase === 'after-rename') await rename(from, to);
      globalThis.saveCrashBarrier = { phase: options.phase, from, to };
      await new Promise(() => {});
    };
    syncBuiltinESMExports();
  }, { target, phase });
}
async function killApp() {
  const process = desktop.process();
  ownedProcesses = processTreeRSS(await snapshot(), [process.pid]).processes;
  assert.ok(ownedProcesses.length > 1, 'The packaged app must include renderer/utility children.');
  const exited = once(process, 'exit'); assert.equal(process.kill('SIGKILL'), true);
  const [code, signal] = await exited; assert.equal(signal, 'SIGKILL'); assert.equal(code, null);
  desktop = null;
  await until(async () => {
    const live = new Set((await snapshot()).trim().split('\n').map(line => Number(line.trim().split(/\s+/)[0])));
    return ownedProcesses.every(child => !live.has(child.pid));
  }, 'all killed app processes to exit');
  const count = ownedProcesses.length; ownedProcesses = [];
  return { mainSignal: signal, appProcessesExited: count };
}
async function close() {
  await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
  await desktop.close(); desktop = null;
}

try {
  const video = await generateDemo(path.join(directory, 'source.mp4')), media = await inspectMedia(video);
  const sourceSHA256 = digest(await readFile(video));
  const trackIndex = media.audioTracks[0].index;
  const transcript = { trackIndex, language: 'ko', channel: 0, model: 'manual crash-test fixture', cues: [{ id: 'first', start: 1, end: 2, text: '저장한 편집을 보존합니다.' }, { id: 'last', start: 14, end: media.duration, text: '마지막 자막을 확인합니다.', timingWarning: { kind: 'source-end', originalEnd: media.duration + .24 } }] };
  const initial = makeProject(media, DEFAULT_SETTINGS, trackIndex, [{ id: 'cut', start: 3, end: 5, enabled: true, reason: 'silence' }], undefined, transcript, { ...DEFAULT_CAPTION_STYLE, enabled: true, preset: 'emphasis' }, undefined, '용어: 하이퍼컷, 무음 구간');
  const seed = path.join(directory, 'seed.json'); await writeFile(seed, JSON.stringify(initial));
  for (const phase of ['before-rename', 'after-rename']) {
    console.log(`${phase}: launching packaged app`);
    const before = await launch(), target = path.join(directory, `${phase}.hypercut.json`);
    await open(before.page, seed, video);
    const baseline = await save(before.page, target), baselineBytes = await readFile(target);
    assert.deepEqual(content(baseline), content(initial));
    await before.page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).fill('-41');
    await before.page.locator('.unsaved-dot').waitFor();
    await chooseSave(target); await arm(target, phase);
    await button(before.page, '프로젝트 저장').first().click();
    const barrier = await until(() => desktop.evaluate(() => globalThis.saveCrashBarrier), `${phase} barrier`);
    assert.equal(barrier.phase, phase); assert.equal(barrier.to, target);
    assert.equal(await before.page.locator('.unsaved-dot').count(), 1);
    assert.equal(await before.page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).count(), 0);
    const replacementBytes = await readFile(phase === 'before-rename' ? barrier.from : target);
    const replacement = validateProject(JSON.parse(replacementBytes.toString()));
    assert.deepEqual(content(replacement), { ...content(baseline), settings: { ...baseline.settings, thresholdDb: -41 } });
    if (phase === 'before-rename') assert.deepEqual(await readFile(target), baselineBytes);
    assert.deepEqual(before.errors, []); assert.deepEqual(before.external, []);
    await before.page.screenshot({ path: path.join(output, `${phase}-pending.png`), fullPage: true });
    const killed = await killApp(), recoveredBytes = await readFile(target);
    assert.deepEqual(recoveredBytes, phase === 'before-rename' ? baselineBytes : replacementBytes);
    const recovered = validateProject(JSON.parse(recoveredBytes.toString()));
    assert.equal(digest(await readFile(video)), sourceSHA256);
    const orphanTemporaryCount = (await readdir(directory)).filter(name => name.startsWith(path.basename(target) + '.') && name.endsWith('.tmp')).length;
    assert.equal(orphanTemporaryCount, phase === 'before-rename' ? 1 : 0);
    console.log(`${phase}: killed ${killed.appProcessesExited} app processes; reopening`);
    const after = await launch(); await open(after.page, target, video);
    assert.equal(await after.page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).inputValue(), String(recovered.settings.thresholdDb));
    assert.equal(await after.page.locator('.cut-row').count(), recovered.cuts.length);
    await button(after.page, '전사와 자막').click();
    assert.equal(await after.page.getByRole('textbox', { name: '프로젝트 교정 용어', exact: true }).inputValue(), recovered.glossary);
    assert.equal(await after.page.locator('.caption-row').count(), recovered.transcript.cues.length);
    await button(after.page, '다음 검토 자막으로 이동').click();
    await after.page.getByText('영상 끝에 걸친 자막입니다', { exact: true }).waitFor();
    assert.equal(await button(after.page, '편집한 SRT 저장').isDisabled(), true);
    await button(after.page, '자막 창 닫기').click();
    const roundTrip = await save(after.page, path.join(directory, `${phase}-roundtrip.json`));
    assert.deepEqual(content(roundTrip), content(recovered));
    await after.page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).fill('-42');
    const retry = await save(after.page, target);
    assert.deepEqual(content(retry), { ...content(recovered), settings: { ...recovered.settings, thresholdDb: -42 } });
    assert.equal(digest(await readFile(video)), sourceSHA256);
    assert.deepEqual(after.errors, []); assert.deepEqual(after.external, []);
    await close();
    report.runs.push({ phase, status: 'PASS', ...killed, projectVersion: recovered.version, sourceSHA256, baselineSHA256: digest(baselineBytes), replacementSHA256: digest(replacementBytes), recoveredSHA256: digest(recoveredBytes), expectedThreshold: recovered.settings.thresholdDb, sourceUnchanged: true, noPrematureSuccess: true, dirtyUntilKilled: true, allProjectFieldsRoundTripped: true, endReviewPreserved: true, saveAfterRestart: true, orphanTemporaryCount, security: before.security, pageErrors: [], externalRequests: 0 });
    await flush();
  }
  report.status = 'completed';
} catch (error) {
  report.status = 'failed'; report.error = error.stack; throw error;
} finally {
  if (desktop) { try { await killApp(); } catch {} }
  // Only PIDs captured from this disposable app are eligible for cleanup.
  if (ownedProcesses.length) {
    const live = (await snapshot()).trim().split('\n');
    for (const child of ownedProcesses) if (live.some(line => Number(line.trim().split(/\s+/)[0]) === child.pid && line.trim().endsWith(child.name))) { try { process.kill(child.pid, 'SIGKILL'); } catch {} }
  }
  await flush(); await rm(directory, { recursive: true, force: true });
}
console.log(JSON.stringify({ status: report.status, reportPath, runs: report.runs }));
