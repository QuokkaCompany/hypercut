import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { parseTranscription } from '../server/transcription.mjs';
import { capture } from '../server/process.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-end-review-ui-')), results = [];
let browser, desktop, server;
try {
  await mkdir('test-output', { recursive: true }); const video = await generateDemo(path.join(directory, 'fixture.mp4')), media = await inspectMedia(video);
  // Reproduce the observed 240ms overrun on a short UI fixture. Actual 60min engine output is tested separately.
  const transcript = parseTranscription({ transcription: [{ offsets: { from: 500, to: 1500 }, text: '앞 자막은 그대로 둡니다.' }, { offsets: { from: 12240, to: 16240 }, text: '영상 끝의 문구를 확인합니다.' }] }, media, 1, { channel: 0, language: 'ko' });
  const project = makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 2, end: 4, enabled: true }], undefined, transcript, { ...DEFAULT_CAPTION_STYLE, enabled: true, preset: 'emphasis' }, undefined, '끝 문구 검토');
  const projectPath = path.join(directory, 'unreviewed.json'); await writeFile(projectPath, JSON.stringify(project));
  async function exercise(page, surface) {
    const errors = [], external = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url()); });
    const button = name => page.getByRole('button', { name, exact: true }), srtButton = button('편집한 SRT 저장');
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await button('전사와 자막').click(); await button('다음 검토 자막으로 이동').click(); await page.getByText('영상 끝에 걸친 자막입니다', { exact: true }).waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '자막 끝', exact: true }).inputValue(), '16'); assert.equal(await srtButton.isEnabled(), false);
    await page.waitForFunction(() => document.querySelector('[aria-label="자막 원본 청취"]')?.textTracks[0]?.cues?.length === 2);
    const vttEnd = await page.evaluate(() => document.querySelector('[aria-label="자막 원본 청취"]').textTracks[0].cues[1].endTime); assert.equal(vttEnd, 16);
    await page.locator('.caption-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-output/end-review-${surface}.png` });
    if (surface === 'browser') { await page.setViewportSize({ width: 390, height: 844 }); await page.locator('.caption-review').scrollIntoViewIfNeeded(); assert.equal(await page.locator('.caption-modal').evaluate(el => el.scrollWidth <= el.clientWidth), true); await page.screenshot({ path: 'test-output/end-review-mobile.png' }); await page.setViewportSize({ width: 1440, height: 1000 }); }
    await button('자막 창 닫기').click(); await button('내보내기').click(); await page.getByRole('alert').filter({ hasText: '출력할 자막의 문구와 경계를 먼저 검토' }).waitFor(); assert.equal(await page.locator('.export-ready').count(), 0); await button('오류 닫기').click();
    await button('전사와 자막').click(); await button('다음 검토 자막으로 이동').click();
    const text = page.getByRole('textbox', { name: '자막 문구', exact: true }); await text.fill('영상 끝을 확인합니다.'); await button('자막 수정 적용').click(); assert.equal(await srtButton.isEnabled(), false);
    await button('문구와 영상 끝 확인 완료').click(); assert.equal(await srtButton.isEnabled(), true);
    await button('자막 실행 취소').click(); assert.equal(await srtButton.isEnabled(), false); await button('자막 다시 실행').click(); assert.equal(await srtButton.isEnabled(), true);
    // An AI text change retains the warning and invalidates the previous explicit review.
    await button('이 자막 AI 교정').click(); await button('AI에게 보낼 요청 복사').click(); await page.getByText('보낼 요청 보기', { exact: true }).click();
    const input = JSON.parse((await page.getByRole('textbox', { name: '복사용 AI 요청', exact: true }).inputValue()).split('\nRequest: ').at(-1));
    await page.getByRole('textbox', { name: 'AI JSON 응답', exact: true }).fill(JSON.stringify({ requestId: input.requestId, changes: [{ id: input.cues[0].id, before: input.cues[0].text, after: '영상 끝의 문구를 확인했어요.', reason: '모의 문구 변경' }] }));
    await button('응답 확인').click(); await page.getByRole('checkbox', { name: '교정 제안 1 적용 선택', exact: true }).check(); await button('선택한 1개 교정 적용').click(); assert.equal(await srtButton.isEnabled(), false);
    await button('문구와 영상 끝 확인 완료').click();
    async function save(control, file, notice) { if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await control.click(); await page.getByText(notice, { exact: true }).waitFor(); } else { const download = page.waitForEvent('download'); await control.click(); await (await download).saveAs(file); } }
    const srtFile = path.join(directory, `${surface}.srt`), savedProject = path.join(directory, `${surface}.json`), mp4 = path.join(directory, `${surface}.mp4`);
    await save(srtButton, srtFile, '편집한 자막을 저장했습니다.'); const srt = await readFile(srtFile, 'utf8'); assert.match(srt, /00:00:10,240 --> 00:00:14,000/); assert.ok(srt.includes('영상 끝의 문구를 확인했어요.'));
    await button('자막 창 닫기').click(); await save(button('프로젝트 저장').first(), savedProject, '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
    const stored = JSON.parse(await readFile(savedProject, 'utf8')); assert.equal(stored.version, 8); assert.equal(stored.glossary, project.glossary); assert.equal(stored.transcript.cues[1].timingWarning.originalEnd, 16.24); assert.ok(stored.transcript.cues[1].reviewedFor); assert.equal(stored.transcript.cues[0].text, transcript.cues[0].text);
    await page.locator('input[type=file]').nth(1).setInputFiles(savedProject); await button('전사와 자막').click(); assert.equal(await srtButton.isEnabled(), true); assert.equal(await button('다음 검토 자막으로 이동').count(), 0); await button('자막 창 닫기').click();
    await button('내보내기').click(); await page.locator('.export-ready').waitFor(); await save(button('편집한 MP4 저장'), mp4, '편집한 영상을 저장했습니다.');
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', mp4, '-f', 'null', '-']); const outputInfo = JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', mp4])); assert.ok(Math.abs(Number(outputInfo.format.duration) - 14) <= 1 / 30);
    await capture('ffmpeg', ['-v', 'error', '-ss', '13.5', '-i', mp4, '-frames:v', '1', '-y', `test-output/end-review-export-${surface}.png`]); await copyFile(mp4, `test-output/end-review-${surface}.mp4`);
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await button('전사와 자막').click(); assert.equal(await srtButton.isEnabled(), false); await button('자막 창 닫기').click();
    assert.deepEqual(errors, []); assert.deepEqual(external, []); results.push({ surface, status: 'PASS', models: 'NOT_RUN in UI fixture; real 60min output covered by parser regression', clippedEnd: 16, originalModelEnd: 16.24, unreviewedSRTDisabled: true, unreviewedMP4Rejected: true, sourceVTTAvailable: true, jumpToReview: true, reviewUndoRedo: true, aiChangeRequiresReviewAgain: true, projectVersion: stored.version, savedReviewRestored: true, unreviewedReloadBlocked: true, srt, actualMP4Decoded: true, outputDuration: Number(outputInfo.format.duration), pageErrors: errors, externalRequests: external.length });
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true }); let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await page.locator('input[type=file]').first().setInputFiles(video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) { desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } }); page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await page.getByRole('button', { name: '영상 추가', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'desktop'); }
} catch (error) { console.error(error); if (desktop) { desktop.process().kill('SIGKILL'); desktop = null; } throw error; }
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile('test-output/transcription-end-e2e.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
