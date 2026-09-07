import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../tests/reference/server/app.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { inspectEffect, publicEffect } from '../tests/reference/server/effects.mjs';
import { capture } from '../tests/reference/server/process.mjs';
import { writeTone, writeFlashVideo } from '../tests/helpers/effects-fixture.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
const dir = await mkdtemp(path.join(os.tmpdir(), 'hypercut-ai-effects-ui-')), results = [];
let browser, desktop, server;
try {
  await mkdir('test-output', { recursive: true });
  const video = await writeFlashVideo(path.join(dir, 'fixture.mp4')), tone = await writeTone(path.join(dir, 'beep.wav')), other = await writeTone(path.join(dir, 'other.wav'), { frequency: 800 });
  const media = await inspectMedia(video), a = await inspectEffect(tone.file), b = await inspectEffect(other.file);
  const clip = (id, start, assetId = a.id) => ({ id, assetId, start, offset: 0, duration: .5, gainDb: -12, muted: false });
  const effects = { assets: [publicEffect(a), publicEffect(b)], clips: [clip('first', 4), clip('second', 6), clip('outside', 7, b.id)] };
  const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: 'a', start: 5, end: 5.6, text: '여기를 강조합니다.' }, { id: 'b', start: 6, end: 6.5, text: '선택하지 않은 자막입니다.' }] };
  const projectPath = path.join(dir, 'project.json'); await writeFile(projectPath, JSON.stringify(makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 2, end: 4, enabled: true }], undefined, transcript, { ...DEFAULT_CAPTION_STYLE, enabled: true, preset: 'emphasis' }, effects)));
  async function exercise(page, surface) {
    const errors = [], external = []; page.on('pageerror', error => errors.push(error.message)); page.on('request', req => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url()); }); page.on('dialog', dialog => dialog.accept());
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await page.getByRole('button', { name: '효과음 편집', exact: true }).click();
    const editor = page.getByRole('dialog', { name: '효과음 편집', exact: true });
    async function reconnect(name, file) { const button = editor.getByRole('button', { name: `${name} 재연결`, exact: true }); if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, file); await button.click(); } else { const chooser = page.waitForEvent('filechooser'); await button.click(); await (await chooser).setFiles(file); } await editor.locator('.effects-missing.connected').filter({ hasText: name }).waitFor(); }
    await reconnect('beep.wav', tone.file); await reconnect('other.wav', other.file);
    async function prepare({ all = false } = {}) {
      await editor.getByRole('button', { name: 'AI 효과음 제안', exact: true }).click();
      const setup = page.getByRole('dialog', { name: 'AI에 보낼 효과음 정보', exact: true });
      assert.equal(await setup.getByRole('button', { name: '선택 정보로 요청 준비', exact: true }).isEnabled(), false);
      await setup.getByRole('checkbox', { name: 'AI 음원 1 선택', exact: true }).check(); await setup.getByRole('textbox', { name: 'AI 음원 1 설명', exact: true }).fill('짧고 부드러운 알림음');
      assert.equal(await setup.getByRole('checkbox', { name: 'AI 클립 3 선택', exact: true }).isEnabled(), false);
      await setup.getByRole('checkbox', { name: 'AI 클립 1 선택', exact: true }).check();
      if (all) { await setup.getByRole('checkbox', { name: 'AI 클립 2 선택', exact: true }).check(); await setup.getByRole('checkbox', { name: 'AI 참고 자막 1 선택', exact: true }).check(); }
      await setup.getByRole('button', { name: '선택 정보로 요청 준비', exact: true }).click();
      await page.getByRole('dialog', { name: 'AI 효과음 제안', exact: true }).waitFor();
    }
    await prepare({ all: true });
    const ai = page.getByRole('dialog', { name: 'AI 효과음 제안', exact: true }); await ai.getByRole('button', { name: 'AI에게 보낼 요청 복사', exact: true }).click(); await ai.getByText('보낼 요청 보기', { exact: true }).click();
    const prompt = await ai.getByRole('textbox', { name: '복사용 AI 요청', exact: true }).inputValue(), input = JSON.parse(prompt.split('\nRequest: ').at(-1));
    assert.equal(input.assets.length, 1); assert.equal(input.clips.length, 2); assert.equal(input.cues.length, 1); assert.equal(input.cues[0].text, transcript.cues[0].text);
    for (const forbidden of ['beep.wav', 'other.wav', a.id, b.id, '선택하지 않은 자막', 'fixture.mp4', 'outside']) assert.ok(!prompt.includes(forbidden), forbidden);
    const proposal = { requestId: input.requestId, changes: [
      { id: 'clip-1', action: 'update', before: input.clips[0], after: { ...input.clips[0], start: 5, duration: .4, gainDb: -6 }, reason: '첫 자막 시각에 맞추고 짧게 강조' },
      { id: 'clip-2', action: 'remove', before: input.clips[1], after: null, reason: '두 번째 클립 삭제 제안 — 선택하지 않을 테스트 항목' },
      { id: 'new-1', action: 'add', before: null, after: { id: 'new-1', assetId: 'asset-1', start: 6.5, offset: .1, duration: .25, gainDb: -12, muted: false }, reason: '뒤쪽에 짧은 알림음 추가' },
    ] };
    const response = ai.getByRole('textbox', { name: 'AI JSON 응답', exact: true }), confirm = ai.getByRole('button', { name: '응답 확인', exact: true });
    await response.fill(JSON.stringify({ ...proposal, changes: [{ ...proposal.changes[0], after: { ...proposal.changes[0].after, start: 99 } }] })); await confirm.click(); await ai.getByRole('alert').filter({ hasText: '시각' }).waitFor();
    await response.fill(JSON.stringify({ ...proposal, changes: [{ ...proposal.changes[2], after: { ...proposal.changes[2].after, assetId: 'asset-2' } }] })); await confirm.click(); await ai.getByRole('alert').filter({ hasText: '음원 정보' }).waitFor();
    await response.fill(JSON.stringify(proposal)); await confirm.click();
    assert.equal(await ai.getByRole('button', { name: '선택한 0개 효과음 제안 적용', exact: true }).isEnabled(), false);
    await ai.getByRole('checkbox', { name: '효과음 제안 1 적용 선택', exact: true }).check(); await ai.getByRole('checkbox', { name: '효과음 제안 3 적용 선택', exact: true }).check();
    await ai.locator('.correction-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-output/ai-effects-${surface}.png` });
    if (surface === 'browser') { await page.setViewportSize({ width: 390, height: 844 }); await ai.locator('.correction-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-output/ai-effects-mobile.png' }); const box = await ai.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390); assert.equal(await ai.evaluate(e => e.scrollWidth <= e.clientWidth), true); await page.setViewportSize({ width: 1440, height: 1000 }); }
    await ai.getByRole('button', { name: '선택한 2개 효과음 제안 적용', exact: true }).click(); await editor.getByText('4개 배치 · 4개 출력', { exact: true }).waitFor();
    await editor.getByRole('button', { name: '효과음 실행 취소', exact: true }).click(); await editor.getByText('3개 배치 · 3개 출력', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '4');
    await editor.getByRole('button', { name: '효과음 다시 실행', exact: true }).click(); await editor.getByText('4개 배치 · 4개 출력', { exact: true }).waitFor(); await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '5');
    // A fresh scope must reject the prior response, and the new route supports
    // cancellation/retry without ever reaching an authenticated model.
    await prepare(); await ai.getByRole('button', { name: 'AI에게 보낼 요청 복사', exact: true }).click(); await ai.getByRole('textbox', { name: 'AI JSON 응답', exact: true }).fill(JSON.stringify(proposal)); await ai.getByRole('button', { name: '응답 확인', exact: true }).click(); await ai.getByRole('alert').filter({ hasText: '현재 요청' }).waitFor();
    let calls = 0, release, delayed = true;
    await page.route('**/api/ai/effects', async route => { if (route.request().method() !== 'POST') { await route.continue(); return; } calls++; const body = route.request().postDataJSON(); if (delayed) await new Promise(resolve => { release = resolve; }); await route.fulfill({ json: { requestId: body.requestId, changes: [] } }).catch(() => {}); });
    await ai.getByLabel('사용할 AI', { exact: true }).selectOption('ollama'); await ai.getByLabel('모델 이름', { exact: true }).fill('fixture-only-model'); await ai.getByRole('button', { name: '연결 설정 저장', exact: true }).click(); await ai.getByRole('button', { name: '연결 해제', exact: true }).waitFor(); assert.equal(calls, 0);
    await ai.getByRole('button', { name: '로컬 AI에 제안 요청', exact: true }).click(); for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(release); await ai.getByRole('button', { name: '요청 취소', exact: true }).click(); await ai.getByText('AI 요청을 취소했습니다.', { exact: true }).waitFor(); release(); release = undefined;
    await ai.getByRole('button', { name: '로컬 AI에 제안 요청', exact: true }).click(); for (let i = 0; i < 100 && !release; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert.ok(release);
    // Dispatch a background edit to exercise stale-context cancellation while
    // the AI reply is still pending. This is not a real provider request.
    await page.getByRole('button', { name: '무음 1 복원', exact: true }).evaluate(button => button.click());
    const changed = page.getByRole('dialog', { name: '효과음 AI 대상 변경', exact: true }); await changed.waitFor(); release(); delayed = false;
    await changed.getByRole('button', { name: '현재 편집에서 다시 선택', exact: true }).click(); const setup = page.getByRole('dialog', { name: 'AI에 보낼 효과음 정보', exact: true }); assert.equal(await setup.getByRole('button', { name: '선택 정보로 요청 준비', exact: true }).isEnabled(), false); await setup.getByRole('button', { name: '효과음 AI 선택 닫기', exact: true }).click();
    await page.getByRole('button', { name: '무음 1 제거', exact: true }).evaluate(button => button.click()); await prepare(); await ai.getByRole('button', { name: '연결 해제', exact: true }).waitFor();
    await ai.getByRole('button', { name: '로컬 AI에 제안 요청', exact: true }).click(); await ai.getByText('AI가 효과음 변경을 제안하지 않았습니다. 기존 편집은 그대로입니다.', { exact: true }).waitFor(); assert.equal(calls, 3); await page.unroute('**/api/ai/effects'); await ai.getByRole('button', { name: 'AI 창 닫기', exact: true }).click(); await editor.getByRole('button', { name: '효과음 창 닫기', exact: true }).click();
    async function save(button, file, notice) { if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await button.click(); await page.getByText(notice, { exact: true }).waitFor(); } else { const download = page.waitForEvent('download'); await button.click(); await (await download).saveAs(file); } }
    const saved = path.join(dir, `${surface}.json`), mp4 = path.join(dir, `${surface}.mp4`);
    await save(page.getByRole('button', { name: '프로젝트 저장', exact: true }).first(), saved, '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.'); const stored = JSON.parse(await readFile(saved, 'utf8')); assert.equal(stored.effects.clips.length, 4); assert.deepEqual(stored.effects.clips[0], { ...effects.clips[0], start: 5, duration: .4, gainDb: -6 }); assert.deepEqual(stored.effects.clips.slice(1, 3), effects.clips.slice(1)); assert.equal(stored.effects.clips[3].assetId, a.id); assert.equal(stored.effects.clips[3].start, 6.5); assert.deepEqual(stored.transcript, transcript);
    await page.locator('input[type=file]').nth(1).setInputFiles(saved); await page.getByRole('button', { name: '내보내기', exact: true }).click(); await page.locator('.export-ready').waitFor(); await save(page.getByRole('button', { name: '편집한 MP4 저장', exact: true }), mp4, '편집한 영상을 저장했습니다.'); await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', mp4, '-f', 'null', '-']); await copyFile(mp4, `test-output/ai-effects-${surface}.mp4`); await capture('ffmpeg', ['-v', 'error', '-ss', '3.2', '-i', mp4, '-frames:v', '1', '-y', `test-output/ai-effects-export-${surface}.png`]);
    const raw = path.join(dir, `${surface}.f32`); await capture('ffmpeg', ['-v', 'error', '-i', mp4, '-vn', '-f', 'f32le', '-c:a', 'pcm_f32le', raw]); const bytes = await readFile(raw);
    const rms = (start, end) => { const first = Math.round(start * 48000), last = Math.round(end * 48000); let sum = 0; for (let i = first; i < last; i++) sum += bytes.readFloatLE(i * 4) ** 2; return Math.sqrt(sum / (last - first)); };
    const levels = { updated: rms(3.1, 3.3), notRemoved: rms(4.1, 4.3), added: rms(4.55, 4.7), outsideSelection: rms(5.1, 5.3), quiet: rms(2, 2.8) };
    assert.ok(Math.abs(levels.updated - .2 / Math.sqrt(2) * 10 ** (-6 / 20)) < .002); for (const key of ['notRemoved', 'added', 'outsideSelection']) assert.ok(Math.abs(levels[key] - .2 / Math.sqrt(2) * 10 ** (-12 / 20)) < .002); assert.equal(levels.quiet, 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ surface, status: 'PASS', authenticatedModels: 'NOT_RUN: manual JSON plus intercepted local UI response', explicitInputSelection: true, filenamesHashesUnselectedCuesNotSent: true, invalidTimeAndUnknownAssetRejected: true, onlySelectedChangesApplied: true, unselectedRemovalAndOutsideClipPreserved: true, oldRequestRejected: true, cancelRetry: true, pendingContextChangeDiscarded: true, selectionResetAfterChange: true, undoRedo: true, projectRoundTrip: true, captionsPreserved: true, actualMP4Decoded: true, expectedEditedTimes: { updated: [3, 3.4], notRemoved: [4, 4.5], added: [4.5, 4.75], outsideSelection: [5, 5.5] }, levels, externalRequests: external.length, pageErrors: errors });
  }
  server = await startServer({ port: 0, dataDir: path.join(dir, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true }); let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await page.locator('input[type=file]').first().setInputFiles(video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) { desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(dir, 'desktop') } }); page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await page.getByRole('button', { name: '영상 추가', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'desktop'); }
} catch (error) { console.error(error); if (desktop) { desktop.process().kill('SIGKILL'); desktop = null; } throw error; }
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(dir, { recursive: true, force: true }); }
await writeFile('test-output/ai-effects-e2e.json', JSON.stringify(results, null, 2)); console.log(JSON.stringify(results));
