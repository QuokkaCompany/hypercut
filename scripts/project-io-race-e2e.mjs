import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';

const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-output/project-io-races');
assert.ok(output.startsWith(path.resolve('test-output') + path.sep)); await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
if (await readFile(reportPath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Results exist; choose a new --output.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-project-io-'));
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const report = { date: new Date().toISOString(), status: 'running', code: (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, scope: 'Real UI/media with delayed File.text return or injected late read error and native fsync-to-rename barrier. Generated files only; no external AI requests.', harnessSHA256: await hash(new URL(import.meta.url)), appSourceSHA256: await hash('src/App.tsx'), packageSHA256: await hash('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'), runs: [] };
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const content = value => { const { savedAt, ...rest } = validateProject(value); return rest; };
const button = (page, name) => page.getByRole('button', { name, exact: true });
const threshold = page => page.getByRole('spinbutton', { name: '음량 임계값', exact: true });
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
let active, sequence = 0;
async function launch(surface, video) {
  const dataDir = path.join(directory, `${surface}-${++sequence}`);
  if (surface === 'desktop') {
    const desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [`--user-data-dir=${path.join(dataDir, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(dataDir, 'media') } });
    active = { desktop, page: await desktop.firstWindow(), async close() { await desktop.evaluate(({ dialog }) => { globalThis.releaseProjectSave?.(); dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await desktop.close(); } };
    active.page.on('dialog', () => {});
    await desktop.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }); }, video);
  } else {
    const server = await startServer({ port: 0, dataDir }), browser = await chromium.launch({ channel: 'chrome', headless: true });
    active = { page: await browser.newPage({ viewport: { width: 1440, height: 960 } }), async close() { await browser.close(); await server.close(); } };
    await active.page.goto(server.url);
  }
  const owner = active, { page } = owner; owner.errors = []; owner.external = [];
  page.on('pageerror', error => owner.errors.push(error.message));
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) owner.external.push(request.url()); });
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  if (surface === 'desktop') await button(page, '영상 추가').click(); else await page.locator('input[type=file]').first().setInputFiles(video);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  return page;
}
async function open(page, file, expectedThreshold) {
  if (await page.locator('.unsaved-dot').count()) page.once('dialog', dialog => dialog.accept());
  const chooser = page.waitForEvent('filechooser'); await button(page, '저장한 프로젝트 열기').click(); await (await chooser).setFiles(file);
  if (expectedThreshold !== undefined) await page.waitForFunction(value => document.querySelector('[aria-label="음량 임계값"]').value === String(value), expectedThreshold);
}
async function snapshot(page, surface, destination) {
  if (surface === 'desktop') {
    await active.desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, destination);
    await button(page, '프로젝트 저장').first().click();
    await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor();
  } else {
    const download = page.waitForEvent('download'); await button(page, '프로젝트 저장').first().click(); await (await download).saveAs(destination);
  }
  await settled(page); return validateProject(JSON.parse(await readFile(destination, 'utf8')));
}
async function slowRead(page, file, rejectAfterRead = false) {
  await page.evaluate(({ name, rejectAfterRead }) => {
    const original = File.prototype.text;
    window.projectReadWaiting = false; window.projectReadFinished = false;
    File.prototype.text = async function () {
      const text = await original.call(this);
      if (this.name === name) { window.projectReadWaiting = true; await new Promise(resolve => { window.releaseProjectRead = resolve; }); window.projectReadFinished = true; if (rejectAfterRead) throw new Error('시험용 지연 파일 읽기 오류'); }
      return text;
    };
  }, { name: path.basename(file), rejectAfterRead });
  await open(page, file); await page.waitForFunction(() => window.projectReadWaiting);
}
async function releaseRead(page) {
  await page.evaluate(() => window.releaseProjectRead()); await page.waitForFunction(() => window.projectReadFinished); await settled(page);
}
async function slowSave(page, destination) {
  await active.desktop.evaluate(({ dialog }, target) => {
    globalThis.projectSaveDialogCalls = 0;
    dialog.showSaveDialog = async () => { globalThis.projectSaveDialogCalls++; return { canceled: false, filePath: target }; };
    const fs = process.getBuiltinModule('fs/promises'), original = fs.rename;
    globalThis.projectSaveWaiting = false; globalThis.projectSaveFinished = false;
    fs.rename = async (from, to) => {
      if (to === target) { globalThis.projectSaveWaiting = true; await new Promise(resolve => { globalThis.releaseProjectSave = resolve; }); }
      const result = await original(from, to);
      if (to === target) { fs.rename = original; process.getBuiltinModule('module').syncBuiltinESMExports(); globalThis.projectSaveFinished = true; }
      return result;
    };
    process.getBuiltinModule('module').syncBuiltinESMExports();
  }, destination);
  await button(page, '프로젝트 저장').first().click();
  for (let i = 0; i < 250; i++) { if (await active.desktop.evaluate(() => globalThis.projectSaveWaiting)) return; await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Native save did not reach rename barrier.');
}
async function releaseSave(page) {
  await active.desktop.evaluate(() => globalThis.releaseProjectSave());
  for (let i = 0; i < 250; i++) { if (await active.desktop.evaluate(() => globalThis.projectSaveFinished)) { await settled(page); return; } await new Promise(resolve => setTimeout(resolve, 40)); }
  throw new Error('Native save did not finish.');
}

try {
  const video = await generateDemo(path.join(directory, 'source.mp4')), media = await inspectMedia(video), track = media.audioTracks[0].index;
  report.sourceSHA256 = await hash(video);
  const first = makeProject(media, DEFAULT_SETTINGS, track, [{ id: 'cut-a', start: 3, end: 5, enabled: true, reason: 'silence' }], undefined, { trackIndex: track, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: 'caption-a', start: 1, end: 2, text: '첫 프로젝트입니다.' }] }, undefined, undefined, '용어 A');
  const second = { ...first, settings: { ...first.settings, thresholdDb: -50 }, glossary: '용어 B', cuts: [{ id: 'cut-b', start: 8, end: 10, enabled: true, reason: 'manual' }], transcript: { ...first.transcript, cues: [{ id: 'caption-b', start: 6, end: 7, text: '두 번째 프로젝트입니다.' }] } };
  const seed = path.join(directory, 'seed.json'), slow = path.join(directory, 'slow.json'), next = path.join(directory, 'next.json');
  await writeFile(seed, JSON.stringify(first)); await writeFile(slow, JSON.stringify({ ...first, settings: { ...first.settings, thresholdDb: -60 } })); await writeFile(next, JSON.stringify(second));
  for (const surface of ['browser', 'desktop']) for (const scenario of ['READ_LATEST', 'READ_LATEST_ERROR', 'READ_EDIT', ...(surface === 'desktop' ? ['SAVE_EDIT', 'SAVE_PROJECT'] : [])]) {
    const result = { surface, scenario, status: 'running' }; report.runs.push(result); await flush();
    try {
      const page = await launch(surface, video); await open(page, seed, -40); await page.locator('.cut-row').waitFor(); await settled(page);
      if (scenario.startsWith('READ')) {
        const latest = scenario.startsWith('READ_LATEST');
        await slowRead(page, slow, scenario === 'READ_LATEST_ERROR');
        if (latest) await open(page, next, -50); else await threshold(page).fill('-42');
        await releaseRead(page);
        result.observedThreshold = await threshold(page).inputValue(); result.observedDirty = await page.locator('.unsaved-dot').count();
        assert.equal(result.observedThreshold, latest ? '-50' : '-42');
        assert.equal(await page.locator('.error-toast').count(), 0);
        if (scenario === 'READ_EDIT') assert.equal(result.observedDirty, 1);
        const saved = await snapshot(page, surface, path.join(directory, `${surface}-${scenario}.json`));
        const expected = latest ? second : { ...first, settings: { ...first.settings, thresholdDb: -42 } };
        assert.deepEqual(content(saved), content(expected)); result.projectFieldsPreserved = true;
      } else {
        await threshold(page).fill('-41'); const destination = path.join(directory, `${scenario}.json`); await slowSave(page, destination);
        assert.equal(await button(page, '프로젝트 저장').first().isDisabled(), true);
        await page.locator('.project-title').click(); await page.keyboard.press('Meta+s');
        assert.equal(await active.desktop.evaluate(() => globalThis.projectSaveDialogCalls), 1); result.duplicateSaveBlocked = true;
        if (scenario === 'SAVE_PROJECT') await open(page, next, -50);
        await threshold(page).fill('-42');
        if (await button(page, '알림 닫기').count()) await button(page, '알림 닫기').click();
        await releaseSave(page);
        // The completion notice proves the renderer has received the IPC reply,
        // rather than observing the dirty state before that reply arrives.
        await page.locator('.notice-toast,.error-toast').waitFor();
        result.observedThreshold = await threshold(page).inputValue(); result.observedDirty = await page.locator('.unsaved-dot').count();
        const persisted = validateProject(JSON.parse(await readFile(destination, 'utf8')));
        assert.deepEqual(content(persisted), content({ ...first, settings: { ...first.settings, thresholdDb: -41 } })); result.requestSnapshotSaved = true;
        assert.equal(result.observedThreshold, '-42'); assert.equal(result.observedDirty, 1);
        if (scenario === 'SAVE_PROJECT') assert.equal(await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).count(), 0);
        await page.screenshot({ path: path.join(output, `${scenario}-state-preserved.png`), fullPage: true });
        const current = scenario === 'SAVE_PROJECT' ? second : first;
        const saved = await snapshot(page, surface, path.join(directory, `${scenario}-latest.json`));
        assert.deepEqual(content(saved), content({ ...current, settings: { ...current.settings, thresholdDb: -42 } })); result.latestSavePreserved = true;
        if (scenario === 'SAVE_EDIT') {
          await threshold(page).fill('-43');
          await active.desktop.evaluate(({ dialog }, source) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: source }); }, video);
          await button(page, '프로젝트 저장').first().click();
          await page.locator('.error-toast').filter({ hasText: '원본 영상과 다른 이름으로 저장해 주세요.' }).waitFor();
          assert.equal(await page.locator('.unsaved-dot').count(), 1);
          assert.equal(await button(page, '프로젝트 저장').first().isEnabled(), true);
          assert.equal(await hash(video), report.sourceSHA256);
          await button(page, '오류 닫기').click();
          const retried = await snapshot(page, surface, path.join(directory, 'after-save-failure.json'));
          assert.deepEqual(content(retried), content({ ...first, settings: { ...first.settings, thresholdDb: -43 } }));
          result.failedSavePreservesDirtyAndRetries = true;
        }
      }
      assert.deepEqual(active.errors, []); assert.deepEqual(active.external, []);
      assert.equal(await hash(video), report.sourceSHA256); result.sourceUnchanged = true;
      result.status = 'PASS'; result.pageErrors = []; result.externalRequests = 0;
    } catch (error) {
      result.status = 'FAIL'; result.error = error.message;
      await active?.page.screenshot({ path: path.join(output, `${surface}-${scenario}-failure.png`), fullPage: true }).catch(() => {});
    } finally { await active?.close(); active = null; await flush(); }
    console.log(JSON.stringify(result));
  }
  report.status = report.runs.every(run => run.status === 'PASS') ? 'completed' : 'failed';
  if (report.status === 'failed') process.exitCode = 1;
} catch (error) {
  report.status = 'failed'; report.error = error.stack; throw error;
} finally { await active?.close(); await flush(); await rm(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: report.status, reportPath }));
