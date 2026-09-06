import { chromium, _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { inspectEffect, publicEffect } from '../server/effects.mjs';
import { writeTone, writeFlashVideo } from '../tests/helpers/effects-fixture.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';

const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-output/effect-import-project-races');
assert.ok(output.startsWith(path.resolve('test-output') + path.sep)); await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
if (await readFile(reportPath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Results exist; choose a new --output.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-effect-project-races-'));
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const report = { date: new Date().toISOString(), status: 'running', code: (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, harnessSHA256: await hash(new URL(import.meta.url)), appSourceSHA256: await hash('src/App.tsx'), effectsSourceSHA256: await hash('src/Effects.tsx'), packageSHA256: await hash('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'), scope: 'Actual project reads, audio inspection/import and media preview. File.text return delayed. Browser request held, same generated audio bytes relayed via multipart to actual server, actual response returned. Native picker response delayed. Generated files only.', runs: [] };
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const threshold = page => page.locator('input[aria-label="음량 임계값"]');
const content = value => { const { savedAt, ...rest } = validateProject(value); return rest; };
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function bounded(promise, label) { let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 30000); })]); } finally { clearTimeout(timer); } }
let active, sequence = 0;
async function launch(surface, source) {
  const dataDir = path.join(directory, `${surface}-${++sequence}`);
  if (surface === 'desktop') {
    const desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [`--user-data-dir=${path.join(dataDir, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(dataDir, 'media') } });
    active = { desktop, page: await desktop.firstWindow(), async close() { await desktop.evaluate(({ dialog }) => { globalThis.releaseEffectDialog?.(); dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await desktop.close(); } };
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
  } else {
    const server = await startServer({ port: 0, dataDir }), browserServer = await chromium.launchServer({ channel: 'chrome', headless: true }), browser = await chromium.connect(browserServer.wsEndpoint());
    active = { page: await browser.newPage({ viewport: { width: 1440, height: 960 } }), async close() { await bounded(browser.close(), 'browser disconnect').catch(() => {}); await bounded(browserServer.close(), 'browser server close').catch(async () => { await browserServer.kill(); }); await bounded(server.close(), 'HTTP server close'); } }; await active.page.goto(server.url);
  }
  const owner = active, page = owner.page; owner.errors = []; owner.external = [];
  page.on('dialog', dialog => { if (dialog.type() === 'confirm') void dialog.accept(); });
  page.on('pageerror', error => owner.errors.push(error.message)); page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) owner.external.push(request.url()); });
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  if (active.desktop) await button(page, '영상 추가').click(); else await page.locator('input[type=file]').first().setInputFiles(source);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); return page;
}
async function open(page, file, expected) {
  const chooser = page.waitForEvent('filechooser'); await button(page, '저장한 프로젝트 열기').click(); await (await chooser).setFiles(file);
  if (expected !== undefined) await page.waitForFunction(value => document.querySelector('[aria-label="음량 임계값"]')?.value === String(value), expected);
}
async function save(page, file) {
  if (await button(page, '알림 닫기').count()) await button(page, '알림 닫기').click();
  if (active.desktop) { await active.desktop.evaluate(({ dialog }, target) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: target }); }, file); await button(page, '프로젝트 저장').first().click(); await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor(); }
  else { const download = page.waitForEvent('download'); await button(page, '프로젝트 저장').first().click(); await (await download).saveAs(file); }
  return validateProject(JSON.parse(await readFile(file, 'utf8')));
}
async function delayProjectRead(page, file) {
  await page.evaluate(name => {
    const original = File.prototype.text;
    File.prototype.text = async function () { const text = await original.call(this); if (this.name === name) { File.prototype.text = original; window.projectReadWaiting = true; await new Promise(resolve => { window.releaseProjectRead = resolve; }); window.projectReadFinished = true; } return text; };
  }, path.basename(file));
  await open(page, file); await page.waitForFunction(() => window.projectReadWaiting);
}
async function releaseRead(page) { await bounded(page.evaluate(() => { window.releaseProjectRead(); }), 'release file read'); await page.waitForFunction(() => window.projectReadFinished); await settled(page); }

try {
  const source = await writeFlashVideo(path.join(directory, 'source.mp4')), media = await inspectMedia(source);
  const audio = [];
  for (const [name, frequency] of [['a', 440], ['b', 800], ['c', 600]]) { const tone = await writeTone(path.join(directory, `${name}.wav`), { frequency }); audio.push({ file: tone.file, asset: publicEffect(await inspectEffect(tone.file)) }); }
  const [a, b, c] = audio; report.sourceHashes = await Promise.all([source, ...audio.map(item => item.file)].map(hash));
  const project = (name, thresholdDb, cut, audio) => makeProject(media, { ...DEFAULT_SETTINGS, thresholdDb }, media.audioTracks[0].index, [{ id: `cut-${name}`, start: cut, end: cut + 1, enabled: true, reason: 'manual' }], undefined, { trackIndex: media.audioTracks[0].index, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: `caption-${name}`, start: 6, end: 6.5, text: `프로젝트 ${name} 자막` }] }, undefined, { assets: [audio.asset], clips: [{ id: `clip-${name}`, assetId: audio.asset.id, start: 1, offset: 0, duration: .5, gainDb: -20, muted: true }] }, `용어 ${name}`);
  const first = project('A', -41, 2, a), second = project('B', -55, 4, b);
  const fileA = path.join(directory, 'project-a.json'), fileB = path.join(directory, 'project-b.json'); await writeFile(fileA, JSON.stringify(first)); await writeFile(fileB, JSON.stringify(second));
  for (const surface of ['browser', 'desktop']) for (const scenario of ['READ_DURING_IMPORT', 'READ_AFTER_IMPORT', 'READ_DURING_RECONNECT', 'CANCEL_THEN_OPEN']) {
    const result = { surface, scenario, status: 'running', routeErrors: [] }; report.runs.push(result); await flush();
    const effectGate = gate(), effectReady = gate(), effectDone = gate();
    try {
      const page = await launch(surface, source); await open(page, fileA, -41); await delayProjectRead(page, fileB); result.phase = 'old-read-pending'; await flush();
      await button(page, '효과음 편집').click(); const panel = page.getByRole('dialog', { name: '효과음 편집', exact: true });
      const reconnect = scenario === 'READ_DURING_RECONNECT', cancelling = scenario === 'CANCEL_THEN_OPEN', chosen = reconnect ? a : c;
      if (active.desktop) {
        await active.desktop.evaluate(({ dialog }, { file, cancelling }) => { globalThis.effectDialogWaiting = false; dialog.showOpenDialog = async () => { globalThis.effectDialogWaiting = true; await new Promise(resolve => { globalThis.releaseEffectDialog = resolve; }); return cancelling ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [file] }; }; }, { file: chosen.file, cancelling });
      } else {
        await page.route('**/api/effects', async route => {
          effectReady.resolve();
          try {
            await effectGate.promise;
            // Playwright route.fetch cannot replay this Chromium file upload intact.
            // Relay the selected fixture bytes to the real endpoint; do not mock its result.
            const response = await page.request.post(route.request().url(), {
              headers: { 'X-Hypercut-Token': route.request().headers()['x-hypercut-token'] },
              multipart: { audio: { name: path.basename(chosen.file), mimeType: 'audio/wav', buffer: await readFile(chosen.file) } },
              timeout: 15000,
            });
            result.actualImportedAsset = await response.json();
            assert.equal(response.status(), 200); assert.equal(result.actualImportedAsset.fingerprint, chosen.asset.fingerprint);
            try { await route.fulfill({ response }); result.importDelivery = 'fulfill-resolved'; }
            catch (error) { const failure = route.request().failure()?.errorText; if (!/ABORT|CANCEL/i.test(failure || '')) throw error; result.importDelivery = failure; }
          } catch (error) { result.routeErrors.push(error.message); await flush(); await route.abort().catch(() => {}); }
          finally { effectDone.resolve(); }
        });
      }
      const pick = panel.getByRole('button', { name: reconnect ? 'a.wav 재연결' : '효과음 추가', exact: true });
      if (active.desktop) { await pick.click(); await page.waitForFunction(() => window.hypercut !== undefined); await bounded((async () => { for (;;) { if (await active.desktop.evaluate(() => globalThis.effectDialogWaiting)) return; await new Promise(resolve => setTimeout(resolve, 20)); } })(), 'native picker'); }
      else { const chooser = page.waitForEvent('filechooser'); await pick.click(); await (await chooser).setFiles(chosen.file); await bounded(effectReady.promise, 'effect upload'); }
      assert.equal(await button(page, '영상 추가').isDisabled(), true); assert.equal(await button(page, '저장한 프로젝트 열기').isDisabled(), true); assert.equal(await button(page, '효과음 창 닫기').isDisabled(), true);
      result.phase = 'effect-pending'; await flush();
      const releaseEffect = async () => { if (active.desktop) await active.desktop.evaluate(() => globalThis.releaseEffectDialog()); else { effectGate.resolve(); await bounded(effectDone.promise, 'effect response'); assert.deepEqual(result.routeErrors, []); } await page.waitForFunction(() => !document.querySelector('button[aria-label="효과음 창 닫기"]')?.disabled, undefined, { timeout: 15000 }); await settled(page); };
      if (cancelling) {
        if (active.desktop) await releaseEffect();
        else { await button(page, '불러오기 취소').click(); await panel.getByRole('alert').filter({ hasText: '취소했습니다' }).waitFor(); }
        await button(page, '효과음 창 닫기').click(); await open(page, fileB, -55);
        await releaseRead(page); if (!active.desktop) { effectGate.resolve(); await bounded(effectDone.promise, 'cancelled effect response'); } await settled(page);
      } else {
        if (scenario === 'READ_AFTER_IMPORT') await releaseEffect();
        await releaseRead(page);
        result.thresholdAfterOldRead = await threshold(page).inputValue(); result.effectsAfterOldRead = await panel.locator('.effect-item').allTextContents();
        result.phase = 'old-read-released'; await flush();
        if (scenario !== 'READ_AFTER_IMPORT') await releaseEffect();
        result.effectsAfterImport = await panel.locator('.effect-item').allTextContents();
        result.dirtyBeforeSave = await page.locator('.unsaved-dot').count();
        await button(page, '효과음 창 닫기').click();
      }
      result.phase = 'saving-result'; await flush();
      const destination = path.join(output, `${surface}-${scenario}.json`), stored = await save(page, destination); result.savedProject = stored;
      let expected = cancelling ? second : first;
      if (!cancelling && !reconnect) {
        const created = stored.effects.clips.find(clip => clip.assetId === c.asset.id); assert.ok(created); assert.match(created.id, /^[0-9a-f-]{36}$/);
        expected = { ...first, effects: { assets: [...first.effects.assets, c.asset], clips: [...first.effects.clips, { id: created.id, assetId: c.asset.id, start: 0, offset: 0, duration: 3, gainDb: -12, muted: false }] } };
        result.mixedProjectObserved = stored.settings.thresholdDb === second.settings.thresholdDb && stored.effects.clips.some(clip => clip.id === 'clip-A') && !stored.effects.clips.some(clip => clip.id === 'clip-B');
      }
      assert.deepEqual(content(stored), content(expected), 'Earlier project read replaced the current effect import target'); result.projectPreserved = true;
      if (!cancelling && !reconnect) {
        assert.equal(result.dirtyBeforeSave, 1); await button(page, '효과음 편집').click(); await button(page, '효과음 실행 취소').click(); await button(page, '효과음 창 닫기').click();
        assert.deepEqual(content(await save(page, path.join(output, `${surface}-${scenario}-undo.json`))), content(first));
        await button(page, '효과음 편집').click(); await button(page, '효과음 다시 실행').click(); await button(page, '효과음 창 닫기').click();
        assert.deepEqual(content(await save(page, path.join(output, `${surface}-${scenario}-redo.json`))), content(expected)); result.undoRedoPreserved = true;
        let completed; const observe = async response => { if (/\/api\/jobs\/[0-9a-f-]+$/.test(response.url())) { const job = await response.json().catch(() => null); if (job?.status === 'completed') completed = job; } }; page.on('response', observe);
        await button(page, '정확한 미리보기').click(); await page.getByText('렌더링된 편집본', { exact: true }).waitFor(); await settled(page); page.off('response', observe);
        assert.equal(completed?.result.audioMix.mixedClips, 1); result.actualMixedPreview = completed.result.audioMix;
      }
      await open(page, fileB, -55); assert.deepEqual(content(await save(page, path.join(output, `${surface}-${scenario}-opened-b.json`))), content(second)); result.laterExplicitProjectOpenWorks = true;
      assert.deepEqual(await Promise.all([source, ...audio.map(item => item.file)].map(hash)), report.sourceHashes); result.sourcesUnchanged = true;
      assert.deepEqual(result.routeErrors, []); assert.deepEqual(active.errors, []); assert.deepEqual(active.external, []); result.status = 'PASS'; result.pageErrors = []; result.externalRequests = 0;
    } catch (error) { result.status = 'FAIL'; result.error = error.stack; await flush(); console.log(JSON.stringify({ surface, scenario, phase: result.phase, error: error.message.split('\n')[0] })); await active?.page.screenshot({ path: path.join(output, `${surface}-${scenario}-failure.png`), fullPage: true, timeout: 5000 }).catch(() => {}); }
    finally { effectGate.resolve(); if (active) { await bounded(active.page.evaluate(() => { window.releaseProjectRead?.(); }), 'cleanup file read').catch(() => {}); await bounded(active.page.unrouteAll({ behavior: 'wait' }), 'cleanup routes').catch(() => {}); await active.close(); } active = null; await flush(); }
    console.log(JSON.stringify({ surface, scenario, status: result.status, mixedProject: result.mixedProjectObserved, error: result.error?.split('\n')[0] }));
  }
  report.status = report.runs.every(run => run.status === 'PASS') ? 'completed' : 'failed'; if (report.status === 'failed') process.exitCode = 1;
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally { await active?.close(); await flush(); await rm(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: report.status, reportPath }));
