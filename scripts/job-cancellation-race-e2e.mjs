import { chromium, _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, rm, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../tests/reference/server/app.mjs';
import { capture } from '../tests/reference/server/process.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { speechFixture } from '../tests/helpers/speech-fixture.mjs';
import { writeTone } from '../tests/helpers/effects-fixture.mjs';
import { inspectEffect, publicEffect } from '../tests/reference/server/effects.mjs';

const option = (name, fallback) => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const output = path.resolve(option('output', 'test-output/job-cancellation-races'));
const allScenarios = ['POST_LATE', 'POLL_LATE_ANALYZE', 'POLL_LATE_EXPORT', 'CANCEL_LATE_SUCCESS', 'CANCEL_LATE_ERROR', 'CANCEL_AFTER_EDIT', 'CURRENT_CANCEL_ERROR', ...['TRANSCRIBE', 'CAPTIONS', 'RESTORE', 'EFFECTS'].flatMap(type => [`POLL_LATE_${type}`, `CANCEL_LATE_ERROR_${type}`]), 'CURRENT_CANCEL_ERROR_TRANSCRIBE', 'CURRENT_CANCEL_ERROR_CAPTIONS'];
const scenarios = option('scenarios', allScenarios.join(',')).split(',');
assert.ok(scenarios.length && scenarios.every(value => allScenarios.includes(value)));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
if (await readFile(reportPath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Results exist; use a new --output.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-job-races-'));
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const report = { date: new Date().toISOString(), status: 'running', code: (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, harnessSHA256: await hash(new URL(import.meta.url)), appSourceSHA256: await hash('src/App.tsx'), packageSHA256: await hash('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'), scope: 'Real generated media, jobs, browser and Mac UI. HTTP delivery barriers; cancellation 503 errors injected. Native file paths controlled. No private footage or external model calls.', runs: [] };
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const threshold = page => page.getByRole('spinbutton', { name: '음량 임계값', exact: true });
const settled = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const content = value => { const { savedAt, ...rest } = validateProject(value); return rest; };
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function bounded(promise, label) { let timeout; try { return await Promise.race([promise, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error(`Timed out: ${label}`)), 60000); })]); } finally { clearTimeout(timeout); } }
let active, sequence = 0;
async function launch(surface) {
  const dataDir = path.join(directory, `${surface}-${++sequence}`);
  if (surface === 'desktop') {
    const desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [`--user-data-dir=${path.join(dataDir, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(dataDir, 'media') } });
    active = { desktop, page: await desktop.firstWindow(), async close() { await desktop.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; }).catch(() => {}); await desktop.close(); } };
  } else {
    const server = await startServer({ port: 0, dataDir }), browser = await chromium.launch({ channel: 'chrome', headless: true });
    active = { page: await browser.newPage({ viewport: { width: 1440, height: 960 } }), async close() { await browser.close(); await server.close(); } };
    await active.page.goto(server.url);
  }
  const owner = active, { page } = owner; owner.errors = []; owner.external = [];
  page.on('dialog', dialog => { if (dialog.type() === 'confirm') void dialog.accept(); });
  page.on('pageerror', error => owner.errors.push(error.message));
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) owner.external.push(request.url()); });
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.evaluate(() => {
    const original = window.fetch; window.cancelJSONCompleted = 0;
    window.fetch = async function (...args) {
      const response = await original.apply(this, args);
      if (args[1]?.method === 'DELETE') {
        const json = response.json.bind(response);
        response.json = async () => { try { return await json(); } finally { window.cancelJSONCompleted++; } };
      }
      return response;
    };
  });
  return page;
}
async function importSource(page, source) {
  if (active.desktop) { await active.desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source); await button(page, '영상 추가').click(); }
  else await page.locator('input[type=file]').first().setInputFiles(source);
  await page.waitForFunction(name => document.querySelector('.media-card > strong')?.textContent === name && document.querySelector('video')?.readyState >= 2, path.basename(source));
}
async function openProject(page, file, value) {
  const chooser = page.waitForEvent('filechooser'); await button(page, '저장한 프로젝트 열기').click(); await (await chooser).setFiles(file);
  await page.waitForFunction(expected => document.querySelector('[aria-label="음량 임계값"]')?.value === expected, String(value)); await settled(page);
}
async function save(page, target) {
  if (await button(page, '알림 닫기').count()) await button(page, '알림 닫기').click();
  if (active.desktop) {
    await active.desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, target);
    await button(page, '프로젝트 저장').first().click(); await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor();
  } else { const download = page.waitForEvent('download'); await button(page, '프로젝트 저장').first().click(); await (await download).saveAs(target); }
  return JSON.parse(await readFile(target, 'utf8'));
}
async function uiSnapshot(page) {
  return { media: await page.locator('.media-card > strong').innerText(), threshold: await threshold(page).inputValue(), cuts: await page.locator('.cut-row').allTextContents(), dirty: await page.locator('.unsaved-dot').count(), videoPath: new URL(await page.locator('video').getAttribute('src'), page.url()).pathname, busy: await page.locator('.job-overlay').count(), errors: await page.locator('.error-toast').allTextContents(), outputButton: await button(page, '편집한 MP4 저장').count() };
}

try {
  const sourceA = path.join(directory, 'source-a.mp4'), sourceB = path.join(directory, 'source-b.mp4');
  if (scenarios.some(value => value.endsWith('TRANSCRIBE'))) {
    const fixture = await speechFixture(path.join(directory, 'speech'));
    await copyFile(fixture.video, sourceA); report.fixture = { kind: 'Korean Eddy TTS', text: fixture.text, duration: fixture.duration, actualWhisper: true };
  } else { await generateDemo(sourceA); report.fixture = { kind: 'synthetic tones' }; }
  const tone = await writeTone(path.join(directory, 'beep.wav')), asset = publicEffect(await inspectEffect(tone.file));
  report.effectSourceSHA256 = await hash(tone.file);
  await capture('ffmpeg', ['-v', 'error', '-i', sourceA, '-t', '8', '-c', 'copy', '-y', sourceB]);
  const mediaA = await inspectMedia(sourceA), mediaB = await inspectMedia(sourceB);
  report.sourceHashes = [await hash(sourceA), await hash(sourceB)];
  assert.notEqual(mediaA.fingerprint, mediaB.fingerprint);
  const project = (media, name, thresholdDb) => makeProject(media, { ...DEFAULT_SETTINGS, thresholdDb }, media.audioTracks[0].index, [{ id: `cut-${name}`, start: 3, end: 4, enabled: true, reason: 'manual' }], undefined, { trackIndex: media.audioTracks[0].index, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: `cue-${name}`, start: 1, end: 2, text: `프로젝트 ${name} 자막` }] }, undefined, undefined, `용어 ${name}`);
  const baseA = project(mediaA, 'A', -41), baseB = project(mediaB, 'B', -50);
  const fileA = path.join(directory, 'project-a.json'), fileB = path.join(directory, 'project-b.json');
  for (const surface of ['browser', 'desktop']) for (const scenario of scenarios) {
    const currentCancelError = scenario.startsWith('CURRENT_CANCEL_ERROR');
    const lateCancelError = scenario.startsWith('CANCEL_LATE_ERROR') || scenario === 'CANCEL_AFTER_EDIT';
    const kind = ['TRANSCRIBE', 'CAPTIONS', 'RESTORE', 'EFFECTS'].find(value => scenario.endsWith(value))?.toLowerCase();
    const withEffects = (base, start, gainDb) => ({ ...base, effects: { assets: [asset], clips: [{ id: `effect-${start}`, assetId: asset.id, start, offset: .1, duration: .5, gainDb, muted: false }] } });
    const projectA = kind === 'effects' ? withEffects(baseA, 1, -12) : baseA, projectB = kind === 'effects' ? withEffects(baseB, 5, -20) : baseB;
    await writeFile(fileA, JSON.stringify(projectA)); await writeFile(fileB, JSON.stringify(projectB));
    const result = { surface, scenario, status: 'running', delivery: [], routeErrors: [] }; report.runs.push(result); await flush();
    const oldGate = gate(), oldReady = gate(), oldDone = gate(), cancelGate = gate(), cancelReady = gate(), cancelDone = gate(), newGate = gate(), newReady = gate();
    let oldId, newId, oldTerminal, newTerminal, postCount = 0, deleteCount = 0;
    try {
      const page = await launch(surface); await importSource(page, sourceA); await openProject(page, fileA, -41);
      let unexpectedDownloads = 0; const downloadObserved = () => { unexpectedDownloads++; }; page.on('download', downloadObserved);
      if (active.desktop) await active.desktop.evaluate(({ dialog }) => { globalThis.unexpectedSaveCalls = 0; dialog.showSaveDialog = async () => { globalThis.unexpectedSaveCalls++; return { canceled: true }; }; });
      const captionPanel = page.getByRole('dialog', { name: '전사와 자막 편집', exact: true });
      const cancelButton = async () => await captionPanel.count() ? captionPanel.getByRole('button', { name: '작업 취소', exact: true }) : button(page, '작업 취소');
      const api = async id => { const config = await (await page.request.get(new URL('/api/config', page.url()).href)).json(); return page.request.get(new URL(`/api/jobs/${id}`, page.url()).href, { headers: { 'X-Hypercut-Token': config.token } }); };
      const deliver = async (route, response, label) => { try { await route.fulfill({ response }); result.delivery.push({ label, outcome: 'fulfill-resolved' }); } catch (error) { const failure = route.request().failure()?.errorText; if (!/ABORT|CANCEL/i.test(failure || '')) throw error; result.delivery.push({ label, outcome: 'transport-already-aborted', failure }); } };
      await page.route('**/api/jobs{,/**}', async route => {
        try {
          const request = route.request(), method = request.method(), pathname = new URL(request.url()).pathname;
          if (method === 'POST') {
            const body = request.postDataJSON(); postCount++;
            if (postCount === 1) {
              oldId = body.requestId; result.oldRequest = { id: oldId, type: body.type, mediaId: body.mediaId };
              if (scenario === 'POST_LATE') { oldReady.resolve(); await oldGate.promise; const response = await route.fetch(); result.latePostResponse = await response.json(); await deliver(route, response, 'old-post'); oldDone.resolve(); return; }
            } else { newId = body.requestId; result.newRequest = { id: newId, type: body.type, mediaId: body.mediaId }; newReady.resolve(); await newGate.promise; }
            await route.continue(); return;
          }
          if (method === 'DELETE' && pathname.endsWith(`/${oldId}`)) {
            deleteCount++;
            if (currentCancelError && deleteCount === 1) { await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled current cancel failure' }) }); return; }
            const response = await route.fetch(); result.cancelServerReply = await response.json();
            if (scenario.startsWith('CANCEL_')) { cancelReady.resolve(); await cancelGate.promise; }
            if (lateCancelError) await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'controlled obsolete cancel failure' }) });
            else await deliver(route, response, 'old-cancel');
            cancelDone.resolve(); return;
          }
          if (method === 'GET' && pathname.endsWith(`/${oldId}`)) {
            let response = await route.fetch(), value = await response.json();
            const deadline = Date.now() + 60000;
            while (value.status === 'running' && Date.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 30)); response = await api(oldId); value = await response.json(); }
            assert.equal(value.status, 'completed'); oldTerminal = value; result.oldTerminal = { id: value.id, status: value.status, type: value.type, outputId: value.result?.id, mediaId: value.mediaId };
            if (kind === 'transcribe') { assert.ok(value.result.cues.length > 0); result.actualTranscription = { model: value.result.model, cues: value.result.cues.length, texts: value.result.cues.map(cue => cue.text) }; }
            if (kind === 'effects') { assert.equal(value.result.audioMix.mixedClips, 1); result.actualEffectMix = value.result.audioMix; }
            if (kind === 'restore') { assert.ok(value.result.cuts.some(cut => !cut.enabled)); result.actualRestoration = value.result.cuts; }
            oldReady.resolve(); await oldGate.promise; await deliver(route, response, 'old-poll'); oldDone.resolve(); return;
          }
          await route.continue();
        } catch (error) { result.routeErrors.push(error.message); oldReady.resolve(); cancelReady.resolve(); oldDone.resolve(); cancelDone.resolve(); newReady.resolve(); await route.abort().catch(() => {}); }
      });
      page.on('response', async response => { if (newId && response.url().endsWith(`/api/jobs/${newId}`)) { const value = await response.json().catch(() => null); if (value?.status === 'completed') newTerminal = value; } });
      const exportOld = ['POLL_LATE_EXPORT', 'CANCEL_LATE_SUCCESS'].includes(scenario);
      if (kind === 'transcribe' || kind === 'captions') {
        await button(page, '전사와 자막').click();
        await button(page, kind === 'transcribe' ? '다시 전사' : '편집한 SRT 저장').click();
        if (kind === 'transcribe' && !currentCancelError) { await button(page, '자막 창 닫기').click(); result.captionWindowClosedDuringJob = true; }
      } else if (kind === 'restore') {
        await button(page, '일부 구간 복원').click(); await page.getByLabel('복원 시작 (초)').fill('3.1'); await page.getByLabel('복원 끝 (초)').fill('3.8'); await button(page, '이 범위 복원').click();
      } else if (kind === 'effects') {
        await button(page, '효과음 편집').click();
        const reconnect = button(page, 'beep.wav 재연결');
        if (active.desktop) { await active.desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, tone.file); await reconnect.click(); }
        else { const chooser = page.waitForEvent('filechooser'); await reconnect.click(); await (await chooser).setFiles(tone.file); }
        await page.getByText('연결됨', { exact: true }).waitFor(); await button(page, '효과음 포함 미리보기').click();
      } else await (exportOld ? button(page, '내보내기') : page.locator('.analyze-button')).click();
      await bounded(oldReady.promise, 'old job barrier');
      assert.deepEqual(result.routeErrors, []); assert.equal(await button(page, '영상 추가').isDisabled(), true);
      await (await cancelButton()).click();
      if (currentCancelError) {
        await page.locator('.error-toast').filter({ hasText: 'controlled current cancel failure' }).waitFor();
        assert.equal(await page.locator('.job-overlay').count(), 1); result.currentErrorVisible = true;
        result.cancelButtonDisabledAfterFailure = await (await cancelButton()).isDisabled();
        assert.equal(result.cancelButtonDisabledAfterFailure, false, 'Current cancel failure must re-enable the visible cancellation control');
        if (!await captionPanel.count()) await button(page, '오류 닫기').click();
        await (await cancelButton()).click();
      }
      if (scenario.startsWith('CANCEL_')) { await bounded(cancelReady.promise, 'cancel response barrier'); oldGate.resolve(); await bounded(oldDone.promise, 'old terminal response'); }
      await page.locator('.job-overlay').waitFor({ state: 'hidden', timeout: 10000 });
      if (await captionPanel.count()) await button(page, '자막 창 닫기').click();
      if (currentCancelError && await button(page, '오류 닫기').count()) await button(page, '오류 닫기').click();
      assert.equal(await page.locator('.cut-row').count(), 1); result.oldProjectCutsPreserved = true;
      const sameProject = scenario === 'CANCEL_AFTER_EDIT' || currentCancelError;
      if (!sameProject) { await importSource(page, sourceB); await openProject(page, fileB, -50); }
      await threshold(page).fill('-42');
      const before = await uiSnapshot(page); result.beforeRelease = before;
      if (!sameProject) { await button(page, '정확한 미리보기').click(); await bounded(newReady.promise, 'new job barrier'); }
      const during = await uiSnapshot(page);
      if (scenario.startsWith('CANCEL_')) {
        cancelGate.resolve(); await bounded(cancelDone.promise, 'late cancellation response');
        await page.waitForFunction(() => window.cancelJSONCompleted >= 1);
      } else { oldGate.resolve(); await bounded(oldDone.promise, 'late original request or poll'); }
      await settled(page);
      const after = await uiSnapshot(page); result.afterRelease = after;
      assert.deepEqual(after, during, 'Obsolete cancellation or job response changed current project/UI');
      assert.equal(after.errors.length, 0); assert.equal(after.dirty, 1); result.currentUIUnchanged = true;
      if (scenario === 'POST_LATE') { const job = await (await api(oldId)).json(); assert.equal(job.status, 'cancelled'); assert.equal(job.result, undefined); result.serverPreCancellationVerified = true; }
      if (!sameProject) {
        newGate.resolve(); await page.locator('.job-overlay').waitFor({ state: 'hidden', timeout: 60000 }); await settled(page);
        assert.equal(newTerminal?.status, 'completed'); assert.equal(newTerminal.mediaId, result.newRequest.mediaId);
        assert.notEqual(result.newRequest.mediaId, result.oldRequest.mediaId);
        assert.equal(new URL(await page.locator('video').getAttribute('src'), page.url()).pathname, `/api/exports/${newTerminal.result.id}`);
        assert.equal(await button(page, '편집한 MP4 저장').count(), 0); result.newPreviewVerified = { id: newTerminal.result.id, duration: newTerminal.result.duration, mediaId: newTerminal.mediaId };
        if (kind === 'effects') assert.equal(newTerminal.result.audioMix.mixedClips, 1);
      }
      assert.equal(unexpectedDownloads, 0); result.unexpectedDownloads = unexpectedDownloads; page.off('download', downloadObserved);
      if (active.desktop) { result.unexpectedNativeSaveCalls = await active.desktop.evaluate(() => globalThis.unexpectedSaveCalls); assert.equal(result.unexpectedNativeSaveCalls, 0); }
      if (currentCancelError) { assert.equal(deleteCount, 2); result.cancelAttempts = deleteCount; }
      const saved = await save(page, path.join(directory, `${surface}-${scenario}.json`));
      assert.deepEqual(content(saved), content({ ...(sameProject ? projectA : projectB), settings: { ...DEFAULT_SETTINGS, thresholdDb: -42 } })); result.allProjectFieldsPreserved = true;
      assert.deepEqual([await hash(sourceA), await hash(sourceB)], report.sourceHashes); result.sourcesUnchanged = true;
      assert.equal(await hash(tone.file), report.effectSourceSHA256); result.effectSourceUnchanged = true;
      assert.deepEqual(result.routeErrors, []); assert.deepEqual(active.errors, []); assert.deepEqual(active.external, []);
      result.pageErrors = []; result.externalRequests = 0; result.status = 'PASS';
    } catch (error) { result.status = 'FAIL'; result.error = error.message; await active?.page.screenshot({ path: path.join(output, `${surface}-${scenario}-failure.png`), fullPage: true }).catch(() => {}); }
    finally { oldGate.resolve(); cancelGate.resolve(); newGate.resolve(); await active?.page.unrouteAll({ behavior: 'wait' }).catch(() => {}); await active?.close(); active = null; await flush(); }
    console.log(JSON.stringify({ surface, scenario, status: result.status, error: result.error }));
  }
  report.status = report.runs.every(run => run.status === 'PASS') ? 'completed' : 'failed'; if (report.status === 'failed') process.exitCode = 1;
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally { await active?.close(); await flush(); await rm(directory, { recursive: true, force: true }); }
console.log(JSON.stringify({ status: report.status, reportPath }));
