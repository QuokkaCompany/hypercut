import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { inspectEffect, publicEffect } from '../server/effects.mjs';
import { capture } from '../server/process.mjs';
import { writeTone, writeFlashVideo } from '../tests/helpers/effects-fixture.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-effects-ui-')), results = [];
let browser, desktop, server;
try {
  await mkdir('test-output', { recursive: true });
  const video = await writeFlashVideo(path.join(directory, 'fixture.mp4')), tone = await writeTone(path.join(directory, 'beep.wav')), wrong = await writeTone(path.join(directory, 'wrong.wav'), { frequency: 800 });
  const media = await inspectMedia(video), asset = await inspectEffect(tone.file), originalHash = createHash('sha256').update(await readFile(tone.file)).digest('hex');
  const project = makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 2, end: 4, enabled: true }], undefined, { trackIndex: 1, channel: 0, language: 'ko', model: 'manual test', cues: [{ id: 'a', start: 5, end: 5.7, text: '효과음과 자막을 함께 확인합니다.' }] }, { ...DEFAULT_CAPTION_STYLE, enabled: true, preset: 'emphasis' }, { assets: [publicEffect(asset)], clips: [{ id: 'clip', assetId: asset.id, start: 4, offset: 0, duration: .5, gainDb: -12, muted: false }] });
  const projectPath = path.join(directory, 'initial.hypercut.json'); await writeFile(projectPath, JSON.stringify(project));
  async function exercise(page, surface) {
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url()); });
    page.on('dialog', dialog => dialog.accept());
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath);
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.locator('.error-toast').filter({ hasText: '다시 연결' }).waitFor();
    assert.equal(await page.locator('.export-ready').count(), 0);
    await page.getByRole('button', { name: '효과음 편집', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '효과음 편집', exact: true });
    await panel.getByText('재연결 필요', { exact: true }).waitFor();
    async function selectAudio(button, file) {
      if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file); await button.click(); }
      else { const chooser = page.waitForEvent('filechooser'); await button.click(); await (await chooser).setFiles(file); }
    }
    await selectAudio(panel.getByRole('button', { name: 'beep.wav 재연결', exact: true }), wrong.file);
    await panel.getByRole('alert').filter({ hasText: '다른 파일' }).waitFor();
    await selectAudio(panel.getByRole('button', { name: 'beep.wav 재연결', exact: true }), tone.file);
    await panel.getByText('연결됨', { exact: true }).waitFor();
    await panel.getByRole('spinbutton', { name: '효과음 배치 시각', exact: true }).fill('5');
    assert.equal(await panel.getByRole('button', { name: '효과음 창 닫기', exact: true }).isEnabled(), false);
    assert.equal(await panel.getByRole('button', { name: '효과음 포함 미리보기', exact: true }).isEnabled(), false);
    await panel.getByRole('spinbutton', { name: '효과음 파일 시작', exact: true }).fill('0.1');
    await panel.getByRole('spinbutton', { name: '효과음 길이', exact: true }).fill('0.7');
    await panel.getByRole('spinbutton', { name: '효과음 음량', exact: true }).fill('-6');
    await panel.getByRole('button', { name: '효과음 수정 적용', exact: true }).click();
    await panel.getByRole('button', { name: '효과음 실행 취소', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '4'); assert.equal(await panel.getByRole('spinbutton', { name: '효과음 배치 시각', exact: true }).inputValue(), '4');
    await panel.getByRole('button', { name: '효과음 다시 실행', exact: true }).click(); await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '5'); assert.equal(await panel.getByRole('spinbutton', { name: '효과음 배치 시각', exact: true }).inputValue(), '5');
    await selectAudio(panel.getByRole('button', { name: '효과음 추가', exact: true }), tone.file);
    await panel.getByText('2개 배치 · 2개 출력', { exact: true }).waitFor();
    await panel.getByRole('checkbox', { name: '효과음 음소거', exact: true }).check(); await panel.getByRole('button', { name: '효과음 수정 적용', exact: true }).click();
    await panel.getByRole('button', { name: '클립 삭제', exact: true }).click(); await panel.getByRole('button', { name: '효과음 실행 취소', exact: true }).click();
    await panel.getByText('2개 배치 · 1개 출력', { exact: true }).waitFor();
    await panel.getByRole('button', { name: '효과음 1 선택', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '5');
    await page.screenshot({ path: `test-output/effects-${surface}.png` });
    if (surface === 'browser') { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'test-output/effects-mobile.png' }); const box = await panel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390); assert.equal(await panel.evaluate(e => e.scrollWidth <= e.clientWidth), true); await page.setViewportSize({ width: 1440, height: 1000 }); }
    await panel.getByRole('button', { name: '효과음 포함 미리보기', exact: true }).click(); await page.getByText('렌더링된 편집본', { exact: true }).waitFor();
    await page.getByRole('button', { name: '효과음 편집', exact: true }).click(); await panel.getByRole('spinbutton', { name: '효과음 음량', exact: true }).fill('-7'); await panel.getByRole('button', { name: '효과음 수정 적용', exact: true }).click(); await panel.getByRole('button', { name: '효과음 창 닫기', exact: true }).click();
    assert.equal(await page.getByText('렌더링된 편집본', { exact: true }).count(), 0);
    const savedProject = path.join(directory, `${surface}.json`), mp4 = path.join(directory, `${surface}.mp4`);
    async function save(button, file, notice) { if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await button.click(); await page.getByText(notice, { exact: true }).waitFor(); } else { const download = page.waitForEvent('download'); await button.click(); await (await download).saveAs(file); } }
    await save(page.getByRole('button', { name: '프로젝트 저장', exact: true }).first(), savedProject, '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
    const stored = JSON.parse(await readFile(savedProject, 'utf8')); assert.equal(stored.version, 6); assert.equal(stored.effects.assets.length, 1); assert.equal(stored.effects.clips.length, 2); assert.equal(stored.effects.clips[0].start, 5); assert.equal(stored.effects.clips[0].offset, .1); assert.equal(stored.effects.clips[0].duration, .7); assert.equal(stored.effects.clips[0].gainDb, -7); assert.equal(stored.effects.clips[1].muted, true); assert.equal(stored.effects.assets[0].path, undefined);
    await page.locator('input[type=file]').nth(1).setInputFiles(savedProject); await page.getByRole('button', { name: '효과음 편집', exact: true }).click(); await panel.getByText('2개 배치 · 1개 출력', { exact: true }).waitFor(); assert.equal(await panel.getByRole('spinbutton', { name: '효과음 음량', exact: true }).inputValue(), '-7'); await panel.getByRole('button', { name: '효과음 창 닫기', exact: true }).click();
    await page.getByRole('button', { name: '내보내기', exact: true }).click(); await page.locator('.export-ready').waitFor();
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, tone.file); await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).click(); await page.locator('.error-toast').filter({ hasText: '효과음 원본과 다른 이름' }).waitFor(); }
    await save(page.getByRole('button', { name: '편집한 MP4 저장', exact: true }), mp4, '편집한 영상을 저장했습니다.');
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', mp4, '-f', 'null', '-']); await capture('ffmpeg', ['-v', 'error', '-ss', '3.2', '-i', mp4, '-frames:v', '1', '-y', `test-output/effects-export-${surface}.png`]);
    await copyFile(mp4, `test-output/effects-${surface}.mp4`);
    const raw = path.join(directory, `${surface}.f32`); await capture('ffmpeg', ['-v', 'error', '-i', mp4, '-vn', '-f', 'f32le', '-c:a', 'pcm_f32le', raw]); const samples = await readFile(raw);
    let peak = 0, power = 0, quietPeak = 0;
    for (let i = 0; i < samples.length / 4; i++) { const value = samples.readFloatLE(i * 4); peak = Math.max(peak, Math.abs(value)); if (i >= 3.1 * 48000 && i < 3.6 * 48000) power += value ** 2; if (i < 2.9 * 48000 || i > 3.8 * 48000) quietPeak = Math.max(quietPeak, Math.abs(value)); }
    const rms = Math.sqrt(power / (.5 * 48000)); assert.ok(Math.abs(rms - .2 * 10 ** (-7 / 20) / Math.sqrt(2)) < .002); assert.ok(quietPeak < .00005); assert.ok(peak < 1);
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(createHash('sha256').update(await readFile(tone.file)).digest('hex'), originalHash);
    results.push({ surface, status: 'PASS', missingAssetBlocked: true, wrongReconnectRejected: true, sameHashReconnected: true, manualEditUndoRedo: true, muteDeleteUndo: true, dirtyDraftGuard: true, stalePreviewInvalidated: true, projectVersion: stored.version, projectRoundTrip: true, captionAndEffectMP4Decoded: true, expectedBeepSeconds: [3, 3.7], rms, peak, quietPeak, sourcePreserved: true, nativeEffectOverwriteBlocked: surface === 'desktop' ? true : 'N/A', externalRequests: external.length, pageErrors: errors });
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true }); let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await page.locator('input[type=file]').first().setInputFiles(video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) { desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } }); page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await page.getByRole('button', { name: '영상 추가', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'desktop'); }
} catch (error) { console.error(error); if (desktop) { desktop.process().kill('SIGKILL'); desktop = null; } throw error; }
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile('test-output/effects-e2e.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
