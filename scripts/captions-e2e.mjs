import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { speechFixture } from '../tests/helpers/speech-fixture.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-caption-ui-'));
const corrected = '작은 목소리도 남겨 주세요. 긴 무음만 줄이면 됩니다.';
let browser, desktop, server; const results = [];
try {
  await mkdir('test-output', { recursive: true });
  const fixture = await speechFixture(directory);
  async function exercise(page, surface) {
    const errors = [], external = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', req => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url()); });
    await page.getByRole('switch', { name: '말소리 보호', exact: true }).check(); await page.locator('.analyze-button').click(); await page.locator('.speech-result').waitFor();
    await page.getByRole('button', { name: '전사와 자막', exact: true }).click();
    const panel = page.getByRole('dialog', { name: '전사와 자막 편집' });
    await page.getByRole('button', { name: '음성 전사 시작', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.caption-row').length === 2);
    await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(x => x.textContent === '다시 전사')?.disabled);
    await page.getByRole('textbox', { name: '자막 문구', exact: true }).fill(corrected);
    await page.getByRole('spinbutton', { name: '자막 시작', exact: true }).fill('1.1'); await page.getByRole('spinbutton', { name: '자막 끝', exact: true }).fill('6.7');
    await page.getByRole('button', { name: '자막 수정 적용', exact: true }).click();
    await page.getByRole('button', { name: '문구와 컷 경계 확인 완료', exact: true }).click();
    // A pending edit cannot disappear just because the user selects another cue.
    await page.getByRole('textbox', { name: '자막 문구', exact: true }).fill('적용하지 않은 문구');
    page.once('dialog', dialog => void dialog.dismiss()); await page.getByRole('button', { name: '자막 2 선택', exact: true }).click();
    assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), '적용하지 않은 문구');
    await page.getByRole('textbox', { name: '자막 문구', exact: true }).fill(corrected);
    await page.getByRole('button', { name: '자막 2 선택', exact: true }).click();
    await page.getByRole('textbox', { name: '자막 문구', exact: true }).fill(corrected);
    await page.getByRole('spinbutton', { name: '자막 시작', exact: true }).fill('10.5'); await page.getByRole('spinbutton', { name: '자막 끝', exact: true }).fill('16.05');
    await page.getByRole('button', { name: '자막 수정 적용', exact: true }).click(); await page.getByRole('button', { name: '문구와 컷 경계 확인 완료', exact: true }).click();
    await page.getByRole('button', { name: '자막 1 선택', exact: true }).click();
    await page.waitForFunction(() => { const video = document.querySelector('.caption-source video'); return video?.readyState >= 2 && video.textTracks[0]?.cues?.length === 2; });
    await page.locator('.caption-source video').evaluate(video => { video.currentTime = 2; video.textTracks[0].mode = 'showing'; });
    await page.screenshot({ path: `test-output/captions-${surface}.png`, fullPage: true });
    const srtPath = path.join(directory, `${surface}.srt`), projectPath = path.join(directory, `${surface}.json`);
    if (surface === 'desktop') {
      await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, srtPath);
      await page.getByRole('button', { name: '편집한 SRT 저장', exact: true }).click(); await page.getByText('편집한 자막을 저장했습니다.', { exact: true }).waitFor();
    } else { const download = page.waitForEvent('download'); await page.getByRole('button', { name: '편집한 SRT 저장', exact: true }).click(); await (await download).saveAs(srtPath); }
    const srt = await readFile(srtPath, 'utf8'); assert.equal(srt.split(corrected).length - 1, 2); assert.ok(!srt.includes('부분')); assert.equal((srt.match(/ --> /g) || []).length, 2);
    await page.getByRole('button', { name: '자막 창 닫기', exact: true }).click();
    if (surface === 'desktop') {
      await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectPath);
      await page.getByRole('button', { name: '프로젝트 저장', exact: true }).first().click(); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    } else { const download = page.waitForEvent('download'); await page.getByRole('button', { name: '프로젝트 저장', exact: true }).first().click(); await (await download).saveAs(projectPath); }
    const project = JSON.parse(await readFile(projectPath, 'utf8')); assert.equal(project.version, 3); assert.equal(project.transcript.cues[0].text, corrected); assert.equal(project.transcript.cues[0].start, 1.1); assert.equal(project.transcript.cues.length, 2); assert.equal(project.cuts.length, 5);
    await page.getByRole('button', { name: '전사와 자막', exact: true }).click();
    await page.getByRole('button', { name: '이 자막 삭제', exact: true }).click(); assert.equal(await page.locator('.caption-row').count(), 1);
    await page.getByRole('button', { name: '자막 실행 취소', exact: true }).click(); assert.equal(await page.locator('.caption-row').count(), 2);
    await page.getByRole('button', { name: '자막 다시 실행', exact: true }).click(); assert.equal(await page.locator('.caption-row').count(), 1);
    await page.getByRole('button', { name: '자막 창 닫기', exact: true }).click();
    page.once('dialog', dialog => void dialog.accept()); await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await page.getByRole('button', { name: '전사와 자막', exact: true }).click(); assert.equal(await page.locator('.caption-row').count(), 2);
    assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), corrected);
    if (surface === 'browser') { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'test-output/captions-mobile.png', fullPage: true }); const box = await panel.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390, JSON.stringify(box)); }
    await page.getByRole('button', { name: '자막 창 닫기', exact: true }).click();
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ surface, status: 'PASS', actualModel: 'Whisper small', fixture: 'Korean TTS, not user footage', editingAndReview: true, draftProtection: true, originalVideoCaptions: true, savedSRT: srt, projectV3RoundTrip: true, captionUndoRedo: true, errors, browserExternalRequests: external.length });
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(fixture.video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) {
    desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } });
    const page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture.video);
    await page.getByRole('button', { name: '영상 추가', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'desktop');
  }
} catch (error) { console.error(error); if (desktop) { desktop.process().kill('SIGKILL'); desktop = null; } throw error; }
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile('test-output/captions-e2e.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
