// Capture the real cloud editor using an original, generated tutorial fixture.
// Requires macOS `say`, Chrome, FFmpeg, a built app and local Whisper setup.
// Generated speech stays private; only silent recordings and screenshots publish.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { chromium } from 'playwright';
import { startAPI, launchWorker } from '../tests/helpers/cloud.mjs';
import { createUser } from '../server/cloud/store.mjs';
import { transcriptionStatus } from '../server/transcription.mjs';
import { capture } from '../server/process.mjs';

const work = await mkdtemp(path.join(os.tmpdir(), 'hypercut-showcase-'));
const evidence = path.resolve('test-output/readme-showcase');
const publish = path.resolve('docs/media');
await mkdir(evidence, { recursive: true });
await mkdir(publish, { recursive: true });
GlobalFonts.registerFromPath(path.resolve('assets/fonts/NotoSansKR-Regular.otf'), 'Showcase');
GlobalFonts.registerFromPath(path.resolve('assets/fonts/NotoSansKR-Bold.otf'), 'Showcase Bold');
const narration = [
  'Start with a short tutorial. Leave a little space between each idea.',
  'Remove the pauses, then review every cut on the timeline.',
  'Create captions from your voice. Fix the wording, choose a style, and export.',
];
const steps = [
  ['Record your idea.', 'Leave room to breathe.'],
  ['Trim the pauses.', 'Keep the words that matter.'],
  ['Make it readable.', 'Review captions. Export your story.'],
];
const probe = async file => JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
function slide(index) {
  const canvas = createCanvas(1280, 720), ctx = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 1280, 720);
  gradient.addColorStop(0, '#182421'); gradient.addColorStop(1, '#0c1214');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1280, 720);
  ctx.strokeStyle = '#ffffff08'; ctx.lineWidth = 1;
  for (let x = 0; x < 1280; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 720); ctx.stroke(); }
  for (let y = 0; y < 720; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1280, y); ctx.stroke(); }
  ctx.fillStyle = '#d5f47a'; ctx.beginPath(); ctx.roundRect(70, 58, 52, 52, 16); ctx.fill();
  ctx.fillStyle = '#171c13'; ctx.font = 'bold 35px Showcase Bold'; ctx.fillText('H', 82, 98);
  ctx.fillStyle = '#e8efe8'; ctx.font = '24px Showcase'; ctx.fillText('HYPERCUT  /  CREATOR NOTES', 140, 96);
  ctx.fillStyle = '#d5f47a'; ctx.font = '20px Showcase'; ctx.fillText(`0${index + 1}  /  THREE TIPS FOR CLEARER TUTORIALS`, 74, 213);
  ctx.fillStyle = '#f3f7ef'; ctx.font = 'bold 67px Showcase Bold'; ctx.fillText(steps[index][0], 70, 318);
  ctx.fillStyle = '#9cafaa'; ctx.font = '30px Showcase'; ctx.fillText(steps[index][1], 74, 375);
  for (let i = 0; i < 3; i++) {
    const x = 74 + i * 383; ctx.fillStyle = i === index ? '#d5f47a' : '#23332e';
    ctx.beginPath(); ctx.roundRect(x, 447, 363, 6, 3); ctx.fill();
    ctx.fillStyle = i === index ? '#d5f47a' : '#779389'; ctx.font = '22px Showcase';
    ctx.fillText(['01  Record', '02  Trim pauses', '03  Add captions'][i], x, 494);
  }
  ctx.fillStyle = '#6d8379'; ctx.font = '18px Showcase'; ctx.fillText('Original sample created for the HyperCut walkthrough', 74, 662);
  return canvas.toBuffer('image/png');
}

let server, worker, browser, page;
const report = { scope: 'Actual cloud UI, generated tutorial sample, silent public media', scenes: [], narration };
try {
  assert.equal((await transcriptionStatus()).ready, true, 'Run npm run setup:transcription first.');
  const segments = [];
  for (let i = 0; i < narration.length; i++) {
    const aiff = path.join(work, `${i}.aiff`), png = path.join(work, `${i}.png`), segment = path.join(work, `${i}.mp4`);
    await writeFile(png, slide(i));
    await capture('/usr/bin/say', ['-v', 'Samantha', '-r', '155', '-o', aiff, narration[i]]);
    const duration = Number((await probe(aiff)).format.duration) + 2.2;
    await capture('ffmpeg', ['-v', 'error', '-loop', '1', '-framerate', '30', '-i', png, '-i', aiff, '-af', 'adelay=650|650,apad', '-t', duration.toFixed(3), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-y', segment]);
    segments.push(segment);
  }
  const sample = path.join(work, 'Creator tutorial.mp4'), list = path.join(work, 'segments.txt');
  await writeFile(list, segments.map(file => `file '${file}'`).join('\n'));
  await capture('ffmpeg', ['-v', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', '-y', sample]);
  report.sourceDuration = Number((await probe(sample)).format.duration);
  server = await startAPI(path.join(work, 'data'));
  const password = randomUUID(); await createUser(server.store, 'demo@example.com', password);
  worker = launchWorker(path.join(work, 'data'));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  // Authenticate before recording; neither login nor credentials enter public assets.
  const login = await browser.newContext(); const loginPage = await login.newPage();
  await loginPage.goto(server.url);
  await loginPage.getByLabel('Email', { exact: true }).fill('demo@example.com');
  await loginPage.getByLabel('Password', { exact: true }).fill(password);
  await loginPage.getByRole('button', { name: 'Sign in', exact: true }).click();
  await loginPage.getByRole('button', { name: 'New edit', exact: true }).waitFor();
  const context = await browser.newContext({ storageState: await login.storageState(), viewport: { width: 1560, height: 1000 }, acceptDownloads: true, recordVideo: { dir: work, size: { width: 1560, height: 1000 } } });
  await login.close();
  page = await context.newPage(); const recordingStart = performance.now();
  page.setDefaultTimeout(30000); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  const scene = async (name, action) => {
    const start = (performance.now() - recordingStart) / 1000;
    await action(); report.scenes.push({ name, start, end: (performance.now() - recordingStart) / 1000 });
  };
  const hold = () => page.waitForTimeout(1800);
  const seek = async (selector, time) => {
    await page.locator(selector).evaluate((video, t) => { video.pause(); video.currentTime = t; }, time);
    await page.waitForTimeout(400);
  };
  await page.goto(server.url);
  await page.getByRole('button', { name: 'New edit', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(sample);
  await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await seek('video', 2);
  await scene('Import tutorial and analyze', async () => { await hold(); await page.locator('.analyze-button').click(); await page.waitForTimeout(500); });
  await page.getByRole('button', { name: '무음 1 복원', exact: true }).waitFor({ timeout: 60000 });
  report.cutCount = await page.locator('.cut-row').count(); assert.ok(report.cutCount >= 3);
  report.editSummary = await page.locator('.result-summary').innerText();
  await seek('video', 2);
  await scene('Review silence edits', async () => {
    await hold(); await page.screenshot({ path: path.join(evidence, 'silence-editing.png') });
    await page.getByRole('button', { name: '무음 1 복원', exact: true }).click(); await page.waitForTimeout(900);
    await page.getByRole('button', { name: '무음 1 제거', exact: true }).click(); await page.waitForTimeout(900);
  });
  await page.getByRole('button', { name: '전사와 자막', exact: true }).click();
  await page.getByRole('combobox', { name: '전사 언어', exact: true }).selectOption('en');
  await page.getByRole('button', { name: '음성 전사 시작', exact: true }).click();
  console.log('Transcribing the tutorial with actual Whisper…');
  await page.locator('.caption-row').first().waitFor({ timeout: 180000 });
  await page.getByRole('button', { name: '다시 전사', exact: true }).waitFor();
  report.captionCount = await page.locator('.caption-row').count(); report.transcribedText = await page.locator('.caption-row').allInnerTexts();
  console.log(JSON.stringify({ captions: report.transcribedText, cuts: report.cutCount }));
  for (let i = 0; i < report.captionCount; i++) {
    await page.getByRole('button', { name: `자막 ${i + 1} 선택`, exact: true }).click();
    // The original fixture's wording is known; inspect each actual cue before acknowledging cut crossings.
    const text = await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue();
    const words = value => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    assert.ok(words(narration.join(' ')).includes(words(text)), `Review unexpected transcript wording: ${text}`);
    const review = page.getByRole('button', { name: /문구와 (컷 경계|영상 끝) 확인 완료/ });
    if (await review.count()) await review.click();
  }
  await page.getByRole('button', { name: '자막 1 선택', exact: true }).click();
  await page.getByRole('switch', { name: 'MP4에 자막 포함', exact: true }).check();
  await page.getByRole('button', { name: '자막 스타일 배경 박스', exact: true }).click();
  await page.getByRole('img', { name: '선택한 자막 디자인 미리보기', exact: true }).waitFor();
  await seek('.caption-source video', 2);
  await page.locator('.caption-workspace').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await scene('Review captions and choose a style', async () => {
    await hold(); await page.locator('.caption-workspace').screenshot({ path: path.join(evidence, 'captions.png') });
    await page.getByRole('button', { name: '자막 스타일 강조형', exact: true }).click(); await page.waitForTimeout(1000);
    await page.getByRole('button', { name: '자막 스타일 배경 박스', exact: true }).click(); await page.waitForTimeout(1000);
  });
  await page.getByRole('button', { name: '자막 창 닫기', exact: true }).click();
  await page.getByRole('button', { name: '프로젝트 저장', exact: true }).click();
  await page.getByText('Project saved on the server.', { exact: true }).waitFor();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.locator('.export-ready').waitFor({ timeout: 180000 });
  report.exportSummary = await page.locator('.export-ready').innerText();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).click();
  const output = path.join(work, 'edited.mp4'); await (await download).saveAs(output);
  await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
  report.outputDuration = Number((await probe(output)).format.duration);
  assert.ok(report.outputDuration < report.sourceDuration - 3);
  await capture('ffmpeg', ['-v', 'error', '-i', output, '-an', '-c:v', 'copy', '-movflags', '+faststart', '-y', path.join(evidence, 'edited-tutorial.mp4')]);
  await page.getByRole('button', { name: 'Workspace', exact: true }).click();
  await page.getByRole('link', { name: 'Download', exact: true }).waitFor();
  await scene('Saved project and completed export', async () => { await hold(); await page.screenshot({ path: path.join(evidence, 'cloud-workspace.png'), fullPage: true }); await hold(); });
  assert.deepEqual(errors, []);
  const recording = page.video(); await context.close();
  const raw = await recording.path();
  // Shorten only idle periods between scenes; preserve actual UI frames and action order.
  const filters = report.scenes.map((s, i) => `[0:v]trim=start=${s.start.toFixed(3)}:end=${s.end.toFixed(3)},setpts=PTS-STARTPTS[v${i}]`);
  filters.push(`${report.scenes.map((_, i) => `[v${i}]`).join('')}concat=n=${report.scenes.length}:v=1:a=0,format=yuv420p[v]`);
  const walkthrough = path.join(evidence, 'walkthrough.mp4');
  await capture('ffmpeg', ['-v', 'error', '-i', raw, '-filter_complex', filters.join(';'), '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '23', '-movflags', '+faststart', '-y', walkthrough]);
  await capture('ffmpeg', ['-v', 'error', '-i', walkthrough, '-filter_complex', 'fps=8,scale=1000:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3', '-loop', '0', '-y', path.join(evidence, 'walkthrough.gif')]);
  for (const file of ['silence-editing.png', 'captions.png', 'cloud-workspace.png', 'edited-tutorial.mp4', 'walkthrough.mp4', 'walkthrough.gif']) await copyFile(path.join(evidence, file), path.join(publish, file));
  await writeFile(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  await page?.screenshot({ path: path.join(evidence, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await browser?.close(); await worker?.close(); await server?.close();
  await rm(work, { recursive: true, force: true });
}
