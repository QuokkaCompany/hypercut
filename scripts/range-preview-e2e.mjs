import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { generateDemo } from './fixtures.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-range-ui-'));
let server, browser, desktop;
const results = [];
async function exercise(page, surface) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.locator('.analyze-button').click();
  await page.getByRole('button', { name: '무음 1 복원', exact: true }).waitFor();
  await page.locator('.cut-select').nth(1).click();
  const summary = await page.locator('.result-summary').innerText();
  const mainVideo = page.locator('.preview-stage > video');
  const sourceURL = await mainVideo.getAttribute('src');
  async function preview(start, end) {
    await page.getByRole('button', { name: '선택 컷 미리보기', exact: true }).click();
    await page.getByLabel('미리보기 시작 (초)').fill(String(start)); await page.getByLabel('미리보기 끝 (초)').fill(String(end));
    await page.getByRole('button', { name: '범위 미리보기 만들기', exact: true }).click();
  }
  await preview(2, 6);
  const playerDialog = page.getByRole('dialog', { name: '컷 경계 미리보기', exact: true });
  await playerDialog.waitFor();
  const player = playerDialog.locator('video');
  await player.evaluate(v => v.play()); await page.waitForFunction(() => document.querySelector('.range-preview-modal video')?.currentTime > 0.2);
  await player.evaluate(v => v.pause());
  const duration = await player.evaluate(v => v.duration); assert.ok(Math.abs(duration - 2.266667) < 0.034);
  const mainTime = await mainVideo.evaluate(v => v.currentTime);
  await page.keyboard.press('ArrowRight'); assert.equal(await mainVideo.evaluate(v => v.currentTime), mainTime);
  await page.screenshot({ path: path.resolve(`test-output/range-${surface}.png`), fullPage: true });
  await page.keyboard.press('Escape'); await playerDialog.waitFor({ state: 'hidden' });
  assert.equal(await mainVideo.getAttribute('src'), sourceURL); assert.equal(await page.locator('.result-summary').innerText(), summary);
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).waitFor();
  assert.match(await page.locator('.export-ready').innerText(), /00:09/);
  await preview(3.5, 4); await page.locator('.error-toast').filter({ hasText: '남아 있는 구간' }).waitFor();
  assert.equal(await page.locator('.cut-row').count(), 5); assert.equal(await page.locator('.export-ready').count(), 1);
  await page.getByRole('button', { name: '오류 닫기', exact: true }).click();
  await page.getByRole('button', { name: '이 구간 복원', exact: true }).click();
  await preview(2, 6); await playerDialog.waitFor();
  await player.evaluate(v => v.play()); await page.waitForFunction(() => document.querySelector('.range-preview-modal video')?.readyState >= 2);
  assert.equal(await player.evaluate(v => v.duration), 4);
  await page.getByRole('button', { name: '미리보기 창 닫기', exact: true }).click();
  await page.getByRole('button', { name: '선택 컷 미리보기', exact: true }).click();
  await page.getByLabel('미리보기 시작 (초)').fill('9'); await page.getByLabel('미리보기 끝 (초)').fill('8');
  assert.equal(await page.getByRole('button', { name: '범위 미리보기 만들기', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '범위 창 닫기', exact: true }).click();
  if (surface === 'browser') {
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await preview(2, 6); await playerDialog.waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const modalBounds = await playerDialog.boundingBox(); assert.ok(modalBounds.x >= 0 && modalBounds.x + modalBounds.width <= 390);
    await page.waitForFunction(() => document.querySelector('.range-preview-modal video')?.readyState >= 2);
    await page.screenshot({ path: path.resolve('test-output/range-mobile.png'), fullPage: true });
    await page.getByRole('button', { name: '미리보기 창 닫기', exact: true }).click();
  }
  assert.deepEqual(errors, []);
  results.push({ surface, status: 'PASS', range: [2, 6], previewSeconds: duration, restoredPreviewSeconds: 4, fullExportRemainsFull: true, mainPlayerUnchanged: true, noPreviewKeyboardLeak: true, removedOnlyRangeRejected: true, invalidRangeDisabled: true, pageErrors: errors });
}
try {
  await mkdir(path.resolve('test-output'), { recursive: true });
  const source = await generateDemo(path.join(directory, 'source.mp4'));
  server = await startServer({ port: 0, dataDir: directory });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(source); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) {
    desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } });
    const window = await desktop.firstWindow(); await window.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await window.getByRole('button', { name: '영상 추가', exact: true }).click(); await window.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await exercise(window, 'desktop');
    // Save the disposable project before closing. Native before-unload dialogs
    // race with Playwright's automatic JavaScript-dialog handling on Electron.
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(directory, 'project.json'));
    await window.getByRole('button', { name: '프로젝트 저장', exact: true }).click();
    await window.waitForFunction(() => !document.querySelector('.unsaved-dot'));
  }
} finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile(path.resolve('test-output/range-preview-e2e.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
