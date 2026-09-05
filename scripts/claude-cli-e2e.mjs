import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { createClaudeCLI } from '../server/claude-cli.mjs';
import { generateDemo } from './fixtures.mjs';
import { fakeClaude } from '../tests/helpers/fake-claude.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cli-ui-'));
let browser, server, desktop;
const results = [];
try {
  await mkdir(path.resolve('test-output'), { recursive: true });
  const fake = await fakeClaude(directory), source = await generateDemo(path.join(directory, 'private-fixture-source.mp4'));
  async function exercise(page, surface) {
    const pageErrors = []; page.on('pageerror', e => pageErrors.push(e.message));
    await fake.set({ loggedIn: false });
    let statusStarted, releaseStatus;
    const statusIncoming = new Promise(resolve => { statusStarted = resolve; });
    if (surface === 'browser') await page.route('**/api/ai/claude/status', async route => {
      statusStarted(); await new Promise(resolve => { releaseStatus = resolve; });
      await route.continue().catch(() => {});
    }, { times: 1 });
    await page.getByRole('button', { name: 'AI 편집 도우미', exact: true }).click();
    await page.getByRole('combobox', { name: /^사용할 AI/ }).selectOption('claude_cli');
    if (surface === 'browser') {
      await statusIncoming;
      try {
        await page.getByRole('button', { name: '연결 설정 저장', exact: true }).click();
        await page.getByRole('button', { name: '연결 해제', exact: true }).waitFor();
      } finally { releaseStatus(); }
    }
    await page.locator('.cli-status').filter({ hasText: '구독 로그인이 필요' }).waitFor();
    assert.equal(await page.getByLabel('API 키', { exact: true }).count(), 0);
    if (surface !== 'browser') await page.getByRole('button', { name: '연결 설정 저장', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: '제안 요청 · Claude 구독 사용', exact: true }).isDisabled(), true);
    await fake.set({}); await page.getByRole('button', { name: '상태 다시 확인', exact: true }).click();
    await page.locator('.cli-status').filter({ hasText: '구독 로그인 확인됨' }).waitFor();
    assert.equal(await page.getByRole('button', { name: '제안 요청 · Claude 구독 사용', exact: true }).isEnabled(), true);
    await page.getByRole('button', { name: '제안 요청 · Claude 구독 사용', exact: true }).click();
    await page.locator('.ai-proposal').waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).inputValue(), '-40');
    await page.getByText('실행 모델: fixture-model · 입력 123 / 출력 45 토큰', { exact: true }).waitFor();
    const record = JSON.parse(await readFile(fake.record, 'utf8'));
    assert.ok(!record.input.includes('private-fixture-source')); assert.equal(record.apiKeyInherited, false); assert.equal(record.providerOverrideInherited, false);
    assert.equal(record.args[record.args.indexOf('--tools') + 1], '');
    assert.ok(!(await page.locator('.ai-modal').innerText()).includes('private-session'));
    await page.screenshot({ path: path.resolve(`test-output/claude-${surface}.png`), fullPage: true });
    await page.getByRole('button', { name: '설정 적용', exact: true }).click();
    assert.equal(await page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).inputValue(), '-45');
    await page.getByRole('button', { name: 'AI 편집 도우미', exact: true }).click();
    await page.getByText('AI 응답을 확인했습니다.', { exact: true }).waitFor();
    await fake.set({ fail: true }); await page.getByRole('button', { name: '제안 요청 · Claude 구독 사용', exact: true }).click();
    await page.locator('.ai-error').waitFor(); assert.ok(!(await page.locator('.ai-error').innerText()).includes('private-provider'));
    assert.equal(await page.locator('.ai-proposal').count(), 0);
    await fake.set({ delayMs: 10000 }); await rm(fake.record, { force: true });
    await page.getByRole('button', { name: '제안 요청 · Claude 구독 사용', exact: true }).click();
    let started = false;
    for (let i = 0; i < 200; i++) { if (await readFile(fake.record).catch(() => null)) { started = true; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(started); const begin = performance.now(); await page.getByRole('button', { name: '요청 취소', exact: true }).click();
    await page.getByText('AI 요청을 취소했습니다.', { exact: true }).waitFor(); const cancellationMs = performance.now() - begin; assert.ok(cancellationMs < 2000);
    await page.getByRole('button', { name: 'AI 창 닫기', exact: true }).click();
    await page.locator('.analyze-button').click(); await page.getByRole('button', { name: '무음 1 복원', exact: true }).waitFor();
    await page.getByRole('button', { name: '내보내기', exact: true }).click(); await page.getByRole('button', { name: '편집한 MP4 저장', exact: true }).waitFor();
    if (surface === 'browser') {
      await fake.set({}); await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole('button', { name: 'AI 도움', exact: true }).click(); await page.locator('.cli-status').filter({ hasText: '구독 로그인 확인됨' }).waitFor();
      const box = await page.locator('.ai-modal').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390);
      await page.screenshot({ path: path.resolve('test-output/claude-mobile.png'), fullPage: true });
      await page.getByRole('button', { name: 'AI 창 닫기', exact: true }).click();
    }
    assert.deepEqual(pageErrors, []);
    results.push({ surface, status: 'PASS', scope: 'Real application and fake Claude executable; no authenticated model request', missingAuthBlocksRequest: true, structuredProposalApplied: true, usageReceipt: { input: 123, output: 45 }, cancellationMs, localExportAfterFailure: true, noPrivateMetadata: true, pageErrors });
  }
  server = await startServer({ port: 0, dataDir: directory, claudeCLI: createClaudeCLI({ executable: fake.executable }) });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(source); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) {
    await fake.set({});
    desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, CLAUDE_CLI_PATH: fake.executable, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } });
    const window = await desktop.firstWindow(); await window.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
    await window.getByRole('button', { name: '영상 추가', exact: true }).click(); await window.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
    await exercise(window, 'desktop');
    await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, path.join(directory, 'project.json'));
    await window.getByRole('button', { name: '프로젝트 저장', exact: true }).click(); await window.waitForFunction(() => !document.querySelector('.unsaved-dot'));
  }
} finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile(path.resolve('test-output/claude-cli-e2e.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
