import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { speechFixture } from '../tests/helpers/speech-fixture.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-speech-ui-'));
let browser, server, desktop;
const results = [];
try {
  await mkdir(path.resolve('test-output'), { recursive: true });
  const fixture = await speechFixture(directory);
  async function exercise(page, surface) {
    const errors = [], external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url()); });
    assert.equal(await page.getByRole('switch', { name: '말소리 보호', exact: true }).isChecked(), false);
    await page.locator('.analyze-button').click(); await page.getByText('모든 구간이 제거되어 내보낼 수 없습니다. 필요한 구간을 복원해 주세요.', { exact: true }).waitFor();
    await page.getByRole('switch', { name: '말소리 보호', exact: true }).check();
    await page.getByText('설정이 바뀌었습니다. 다시 분석하면 새 기준을 적용합니다.', { exact: true }).waitFor();
    await page.locator('.analyze-button').click();
    await page.locator('.speech-result').filter({ hasText: '11.47초 추가 보존' }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('.cut-row').count(), 5);
    await page.locator('.speech-result summary').click();
    await page.getByRole('button', { name: '감지한 말소리 1로 이동', exact: true }).click();
    await page.waitForFunction(() => Math.abs(document.querySelector('video').currentTime - 1.056) < 0.04);
    await page.getByRole('button', { name: '정확한 미리보기', exact: true }).click();
    await page.getByText('렌더링된 편집본', { exact: true }).waitFor();
    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).waitFor();
    const projectPath = path.join(directory, `${surface}-project.json`), outputPath = path.join(directory, `${surface}-output.mp4`);
    if (surface === 'desktop') {
      await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, outputPath);
      await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).click();
      await page.getByText('편집한 영상을 저장했습니다.', { exact: true }).waitFor();
      await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, projectPath);
      await page.getByRole('button', { name: '프로젝트 저장', exact: true }).click();
      await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    } else {
      const videoDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).click(); await (await videoDownload).saveAs(outputPath);
      const projectDownload = page.waitForEvent('download'); await page.getByRole('button', { name: '프로젝트 저장', exact: true }).first().click(); await (await projectDownload).saveAs(projectPath);
    }
    const project = JSON.parse(await readFile(projectPath, 'utf8'));
    assert.equal(project.version, 2); assert.deepEqual(project.speechProtection, { enabled: true, threshold: 0.5 });
    assert.ok((await readFile(outputPath)).length > 1000);
    await page.screenshot({ path: path.resolve(`test-output/speech-${surface}.png`), fullPage: true });
    await page.getByRole('slider', { name: '음성 감지 기준', exact: true }).fill('0.35');
    await page.getByText('설정이 바뀌었습니다. 다시 분석하면 새 기준을 적용합니다.', { exact: true }).waitFor();
    page.once('dialog', dialog => void dialog.accept());
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath);
    await page.waitForFunction(() => document.querySelector('#speech-threshold')?.value === '0.5');
    assert.equal(await page.getByRole('slider', { name: '음성 감지 기준', exact: true }).inputValue(), '0.5');
    const oldPath = path.join(directory, `${surface}-v1.json`); await writeFile(oldPath, JSON.stringify({ ...project, version: 1, speechProtection: undefined }));
    await page.locator('input[type=file]').nth(1).setInputFiles(oldPath);
    await page.waitForFunction(() => !document.querySelector('input[role=switch]')?.checked);
    assert.equal(await page.getByRole('switch', { name: '말소리 보호', exact: true }).isChecked(), false);
    assert.equal(await page.locator('.cut-row').count(), 5);
    if (surface === 'browser') {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('switch', { name: '말소리 보호', exact: true }).check();
      await page.locator('.speech-protection').scrollIntoViewIfNeeded();
      const box = await page.locator('.speech-protection').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
      await page.screenshot({ path: path.resolve('test-output/speech-mobile.png'), fullPage: true });
    }
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ surface, status: 'PASS', model: 'Actual bundled Silero VAD 6.2.1', input: 'Generated quiet Korean TTS; not user footage', baselineKeptSeconds: 0, speechProtectionKeptSeconds: 11.466667, cuts: 5, projectV2RoundTrip: true, projectV1Migration: true, previewAndSavedExport: true, externalBrowserRequests: external.length, pageErrors: errors });
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'web') });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(fixture.video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) {
    desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } });
    const window = await desktop.firstWindow(); await window.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, fixture.video);
    await window.getByRole('button', { name: '영상 추가', exact: true }).click(); await window.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await exercise(window, 'desktop');
  }
} catch (error) {
  console.error(error);
  // Only this harness's disposable app may be forced closed after a failed
  // assertion. Do not let its unsaved-fixture dialog hide the original error.
  if (desktop) { desktop.process().kill('SIGKILL'); desktop = null; }
  throw error;
} finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile(path.resolve('test-output/speech-e2e.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
