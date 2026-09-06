import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject, DEFAULT_SETTINGS, validateProject } from '../shared/timeline.mjs';
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-glossary-ui-')), results = [];
const glossary = '캡컶 → 캡컷\n기술 용어: 무음 구간, Whisper', temporary = '이번 요청만: 하이퍼컷';
const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: 'a', start: 1, end: 2.5, text: '캡컶으로 편집해요.' }, { id: 'b', start: 7, end: 8.5, text: '무음 구간을 줄여요.' }] };
let browser, desktop, server;
try {
  await mkdir('test-output', { recursive: true });
  const video = await generateDemo(path.join(directory, 'fixture.mp4')), media = await inspectMedia(video);
  const legacy = { ...makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 3, end: 5, enabled: true }], undefined, transcript), version: 5 }; delete legacy.glossary;
  const initialPath = path.join(directory, 'legacy.json'); await writeFile(initialPath, JSON.stringify(legacy));
  async function exercise(page, surface) {
    console.log(`${surface}: start`);
    const errors = [], external = [], modelRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url()); if (/\/api\/ai\/(correction|effects|proposal)$/.test(req.url()) && req.method() === 'POST') modelRequests.push(req.postDataJSON()); });
    const button = name => page.getByRole('button', { name, exact: true });
    const terms = page.getByRole('textbox', { name: '프로젝트 교정 용어', exact: true });
    const requestTerms = page.getByRole('textbox', { name: '교정 참고 용어', exact: true });
    async function open(file) { await page.locator('input[type=file]').nth(1).setInputFiles(file); await page.waitForFunction(() => !document.querySelector('.unsaved-dot')); }
    async function captions() { await button('전사와 자막').click(); await terms.waitFor(); }
    async function save(file) {
      if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await button('프로젝트 저장').first().click(); await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor(); }
      else { const download = page.waitForEvent('download'); await button('프로젝트 저장').first().click(); await (await download).saveAs(file); }
      await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
      return JSON.parse(await readFile(file, 'utf8'));
    }
    async function prompt() { await button('AI에게 보낼 요청 복사').click(); const area = page.getByRole('textbox', { name: '복사용 AI 요청', exact: true }); if (!await area.isVisible()) await page.getByText('보낼 요청 보기', { exact: true }).click(); return JSON.parse((await area.inputValue()).split('\nRequest: ').at(-1)); }
    await open(initialPath); await captions(); assert.equal(await terms.inputValue(), ''); assert.equal(await terms.getAttribute('maxlength'), '2000');
    await terms.fill(glossary);
    // A clean, saved project with only an unapplied glossary draft must still block window loss.
    assert.equal(await page.locator('.unsaved-dot').count(), 0);
    if (surface === 'browser') {
      const dialog = page.waitForEvent('dialog'); await page.evaluate(() => { setTimeout(() => location.reload(), 0); }); const guard = await dialog; assert.equal(guard.type(), 'beforeunload'); await guard.dismiss();
    } else {
      // Electron handles this beforeunload with a native dialog; do not also send a CDP dismiss.
      const nativeGuardObserver = () => {}; page.on('dialog', nativeGuardObserver);
      await desktop.evaluate(({ BrowserWindow, dialog }) => { globalThis.glossaryCloseGuards = 0; dialog.showMessageBoxSync = () => { globalThis.glossaryCloseGuards++; return 0; }; BrowserWindow.getAllWindows()[0].close(); });
      for (let i = 0; i < 100 && !await desktop.evaluate(() => globalThis.glossaryCloseGuards); i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(await desktop.evaluate(() => globalThis.glossaryCloseGuards), 1); assert.equal(page.isClosed(), false); page.off('dialog', nativeGuardObserver);
    }
    console.log(`${surface}: window guard passed`);
    assert.equal(await terms.inputValue(), glossary); assert.equal(await button('이 자막 AI 교정').isEnabled(), false); assert.equal(await button('편집한 SRT 저장').isEnabled(), false);
    page.once('dialog', dialog => dialog.dismiss()); await button('자막 창 닫기').click(); assert.equal(await terms.inputValue(), glossary);
    await button('프로젝트 용어 적용').click(); await page.locator('.unsaved-dot').waitFor(); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), transcript.cues[0].text);
    await button('자막 실행 취소').click(); await page.waitForFunction(() => document.querySelector('[aria-label="프로젝트 교정 용어"]').value === '');
    await button('자막 다시 실행').click(); await page.waitForFunction(value => document.querySelector('[aria-label="프로젝트 교정 용어"]').value === value, glossary);
    await terms.fill('아직 적용하지 않은 용어'); page.once('dialog', dialog => dialog.dismiss()); await button('자막 실행 취소').click(); assert.equal(await terms.inputValue(), '아직 적용하지 않은 용어');
    page.once('dialog', dialog => dialog.accept()); await button('자막 2 선택').click(); assert.equal(await terms.inputValue(), glossary); await button('자막 1 선택').click();
    const captionText = page.getByRole('textbox', { name: '자막 문구', exact: true });
    await captionText.fill('미적용 자막 문구'); await terms.fill('미적용 용어'); page.once('dialog', dialog => dialog.accept()); await button('자막 1 선택').click();
    assert.equal(await captionText.inputValue(), transcript.cues[0].text); assert.equal(await terms.inputValue(), glossary); assert.equal(await button('이 자막 AI 교정').isEnabled(), true);
    await terms.scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-output/glossary-${surface}.png` });
    if (surface === 'browser') { await page.setViewportSize({ width: 390, height: 844 }); await terms.scrollIntoViewIfNeeded(); const bounds = await page.getByRole('dialog', { name: '전사와 자막 편집' }).boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390); assert.equal(await page.locator('.caption-modal').evaluate(el => el.scrollWidth <= el.clientWidth), true); await page.screenshot({ path: 'test-output/glossary-mobile.png' }); await page.setViewportSize({ width: 1440, height: 1000 }); }
    await button('이 자막 AI 교정').click(); assert.equal(await requestTerms.inputValue(), glossary);
    const original = await prompt(); assert.equal(original.glossary, glossary); assert.equal(original.cues.length, 1); assert.ok(!JSON.stringify(original).includes(media.fingerprint)); assert.ok(!JSON.stringify(original).includes('fixture.mp4'));
    const oldProposal = { requestId: original.requestId, changes: [{ id: 'a', before: transcript.cues[0].text, after: '캡컷으로 편집해요.', reason: '앱 이름 교정' }] };
    const response = page.getByRole('textbox', { name: 'AI JSON 응답', exact: true });
    await response.fill(JSON.stringify(oldProposal)); await button('응답 확인').click(); assert.equal(await page.locator('.correction-change').count(), 1);
    await requestTerms.fill(temporary); assert.equal(await page.locator('.correction-change').count(), 0); await button('응답 확인').click(); await page.getByRole('alert').filter({ hasText: '요청을 먼저 복사' }).waitFor();
    const overridden = await prompt(); assert.equal(overridden.glossary, temporary); assert.notEqual(overridden.requestId, original.requestId); await button('응답 확인').click(); await page.getByRole('alert').filter({ hasText: '현재 요청' }).waitFor();
    await requestTerms.fill(''); assert.equal((await prompt()).glossary, '');
    await button('프로젝트 용어로 되돌리기').click(); assert.equal(await requestTerms.inputValue(), glossary);
    // All saving, preparation and manual validation so far made no model call.
    assert.deepEqual(modelRequests, []);
    const payloads = [];
    await page.route('**/api/ai/correction', async route => { if (route.request().method() !== 'POST') return route.continue(); const body = route.request().postDataJSON(); payloads.push(body); await route.fulfill({ json: { requestId: body.requestId, changes: [] } }); });
    await page.getByLabel('사용할 AI', { exact: true }).selectOption('ollama'); await page.getByLabel('모델 이름', { exact: true }).fill('fixture-only-model'); await button('연결 설정 저장').click(); await button('연결 해제').waitFor(); assert.equal(payloads.length, 0);
    await requestTerms.fill(temporary); await button('로컬 AI에 제안 요청').click(); await page.getByText('AI가 수정할 문구를 제안하지 않았습니다. 원문은 그대로입니다.', { exact: true }).waitFor(); assert.equal(payloads.length, 1); assert.equal(payloads[0].glossary, temporary);
    await button('연결 해제').click(); await page.unroute('**/api/ai/correction'); await button('AI 창 닫기').click(); assert.equal(await terms.inputValue(), glossary);
    await button('이 자막 AI 교정').click(); assert.equal(await requestTerms.inputValue(), glossary); await button('AI 창 닫기').click(); await button('자막 창 닫기').click();
    const savedPath = path.join(directory, `${surface}.json`), saved = await save(savedPath);
    assert.equal(saved.version, 6); assert.equal(saved.glossary, glossary); assert.deepEqual(saved.transcript, transcript);
    for (const field of ['cuts', 'settings', 'speechProtection', 'captionStyle', 'effects']) assert.deepEqual(saved[field], validateProject(legacy)[field]);
    // Reload from bytes, then verify malformed v6 cannot replace the active project.
    await open(initialPath); await captions(); assert.equal(await terms.inputValue(), ''); await button('자막 창 닫기').click();
    await open(savedPath); await captions(); assert.equal(await terms.inputValue(), glossary); assert.equal(await button('자막 실행 취소').isEnabled(), false); await button('자막 창 닫기').click();
    const badPath = path.join(directory, `${surface}-bad.json`); await writeFile(badPath, JSON.stringify({ ...saved, glossary: ['invalid'] })); await page.locator('input[type=file]').nth(1).setInputFiles(badPath); await page.getByText('교정 용어는 제어 문자 없이 2,000자 이내로 입력해 주세요.', { exact: true }).waitFor();
    await captions(); assert.equal(await terms.inputValue(), glossary); await button('자막 창 닫기').click();
    const preserved = await save(path.join(directory, `${surface}-after-invalid.json`)); assert.equal(preserved.glossary, glossary); assert.deepEqual(preserved.transcript, transcript); assert.deepEqual(preserved.cuts, saved.cuts);
    // Import a new project using the same source: glossary/history do not leak into it.
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await button('영상 추가').click(); }
    else await page.locator('input[type=file]').first().setInputFiles(video);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await captions(); assert.equal(await terms.inputValue(), ''); assert.equal(await button('자막 실행 취소').isEnabled(), false); await button('자막 창 닫기').click();
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.equal(modelRequests.length, 1);
    console.log(`${surface}: complete`);
    results.push({ surface, status: 'PASS', projectVersion: saved.version, migrationV5: true, undoRedo: true, unappliedDraftWindowGuard: true, draftDiscardAndCancel: true, temporaryOverrideAndBlank: true, oldProposalInvalidated: true, noAutomaticModelCalls: true, requestPayload: 'intercepted local request with explicit temporary glossary', realModels: 'NOT_RUN', saveReopen: true, malformedProjectPreservesEditing: true, newMediaResetsGlossary: true, transcriptCutsStylePreserved: true, pageErrors: errors, externalRequests: external.length });
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await page.locator('input[type=file]').first().setInputFiles(video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) { desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } }); page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await page.getByRole('button', { name: '영상 추가', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'desktop'); }
} catch (error) { console.error(error); if (desktop) { desktop.process().kill('SIGKILL'); desktop = null; } throw error; }
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
await writeFile('test-output/glossary-e2e.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
