import { chromium, _electron as electron } from 'playwright';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { inspectEffect, publicEffect } from '../server/effects.mjs';
import { capture } from '../server/process.mjs';
import { writeTone, writeFlashVideo } from '../tests/helpers/effects-fixture.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import assert from 'node:assert/strict';

const output = path.resolve(process.argv.find(x => x.startsWith('--output='))?.slice(9) || `test-output/mcp-ui-${Date.now()}`);
await mkdir(output, { recursive: false });
const report = { status: 'running', date: new Date().toISOString(), scope: 'Actual local MCP stdio children and Chrome/packaged Mac UI. Synthetic media, no external model/account/tunnel. Native dialog results selected by test.', sourceHashes: {}, runs: [] };
for (const f of ['src/MCPShare.tsx', 'src/AIAssistant.tsx', 'server/app.mjs', 'server/mcp-shares.mjs', 'server/mcp-routes.mjs', 'server/mcp-bridge.mjs', 'server/mcp-stdio.mjs', 'package-lock.json', 'scripts/mcp-e2e.mjs', 'release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar']) report.sourceHashes[f] = createHash('sha256').update(await readFile(f)).digest('hex');
const clients = []; let browser, desktop, server;
const button = (page, name) => page.getByRole('button', { name, exact: true });
const original = '자막 입니디.', corrected = '자막입니다.';
try {
  const video = await writeFlashVideo(path.join(output, 'fixture.mp4')), tone = await writeTone(path.join(output, 'beep.wav'));
  const media = await inspectMedia(video), asset = await inspectEffect(tone.file);
  const effects = { assets: [publicEffect(asset)], clips: [{ id: 'first', assetId: asset.id, start: 4, offset: 0, duration: .5, gainDb: -12, muted: false }] };
  const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: 'a', start: 1, end: 1.8, text: original }, { id: 'b', start: 5, end: 5.6, text: '소리를 없애지 않습니다.' }] };
  const initial = makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 2, end: 4, enabled: true, reason: 'silence' }], undefined, transcript, undefined, effects);
  const projectPath = path.join(output, 'initial.json'); await writeFile(projectPath, JSON.stringify(initial));
  async function exercise(page, surface) {
    const errors = [], external = [], aiCalls = [], capabilityValues = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', req => {
      if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url())) external.push(req.url());
      if (/\/api\/ai\/(proposal|correction|translation|effects)$/.test(req.url())) aiCalls.push(req.url());
    });
    page.on('dialog', dialog => dialog.accept());
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath);
    await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    async function shareTask(panel, task) {
      await panel.getByLabel('사용할 AI', { exact: true }).selectOption('mcp');
      await button(panel, 'MCP로 이 요청 공유').click();
      await panel.getByText('MCP 연결 설정 보기', { exact: true }).click();
      const config = JSON.parse(await panel.getByRole('textbox', { name: 'MCP 연결 설정', exact: true }).inputValue()).mcpServers.hypercut;
      capabilityValues.push(config.env.HYPERCUT_MCP_CAPABILITY);
      await panel.getByText('MCP 연결 설정 보기', { exact: true }).click();
      const transport = new StdioClientTransport({ ...config, stderr: 'pipe' });
      const client = new Client({ name: 'hypercut-ui-verification', version: '1.0.0' }); clients.push(client);
      let stderr = ''; transport.stderr.on('data', chunk => { stderr += chunk; });
      await client.connect(transport); const listing = await client.listTools(); assert.equal(listing.tools.length, 2);
      const read = async () => client.callTool({ name: 'get_shared_edit_context', arguments: {} });
      const context = await read(); assert.ok(!context.isError, JSON.stringify(context)); assert.equal(context.structuredContent.task, task);
      assert.doesNotMatch(JSON.stringify(context), /fixture\.mp4|beep\.wav|capability/);
      const send = async proposal => {
        const args = { contextVersion: context.structuredContent.contextVersion, proposalId: randomUUID(), proposal };
        const result = await client.callTool({ name: 'submit_edit_proposal', arguments: args }); assert.ok(!result.isError, JSON.stringify(result)); assert.equal(result.structuredContent.status, 'proposed');
        assert.equal((await client.callTool({ name: 'submit_edit_proposal', arguments: args })).structuredContent.proposalId, args.proposalId);
        return args;
      };
      const receipt = async ids => {
        let current;
        for (let i = 0; i < 100; i++) { current = await read(); if (current.structuredContent?.status === 'applied') break; await new Promise(resolve => setTimeout(resolve, 50)); }
        assert.equal(current.structuredContent?.status, 'applied'); assert.deepEqual(current.structuredContent.resolution.selectedIds, ids); assert.equal(current.structuredContent.context, null); assert.equal(stderr, '');
      };
      return { client, read, send, receipt, input: context.structuredContent.context.request, config };
    }
    await button(page, 'AI 편집 도우미').click();
    let panel = page.getByRole('dialog', { name: 'AI 편집 도우미', exact: true });
    const old = await shareTask(panel, 'settings');
    await page.route('**/api/ai/shares/*', async route => { if (route.request().method() === 'DELETE') await route.fulfill({ status: 503, json: { error: 'test revocation interruption' } }); else await route.continue(); });
    await button(panel, '공유 해제').click(); await button(panel, '공유 해제 다시 시도').waitFor();
    await panel.getByRole('alert').filter({ hasText: '즉시 공유 해제를 확인하지 못했습니다.' }).waitFor();
    assert.ok(!(await old.read()).isError);
    assert.equal(await panel.getByText('공유를 해제했습니다.', { exact: true }).count(), 0);
    await page.unroute('**/api/ai/shares/*'); await button(panel, '공유 해제 다시 시도').click();
    await panel.getByText('공유를 해제했습니다.', { exact: true }).waitFor(); assert.equal((await old.read()).isError, true);
    const outdated = await shareTask(panel, 'settings');
    await panel.locator('label.ai-field').filter({ hasText: '어떻게 편집할까요?' }).locator('textarea').fill('긴 무음만 제거해 주세요.');
    await panel.getByText('요청이나 편집 대상이 바뀌어 이전 공유 해제를 요청했습니다. 다시 공유해 주세요.', { exact: true }).waitFor();
    assert.equal((await outdated.read()).isError, true);
    const setting = await shareTask(panel, 'settings');
    await setting.send({ settings: { ...DEFAULT_SETTINGS, minSilenceMs: 800 }, explanation: '짧은 쉼을 남깁니다.' });
    await button(panel, '설정 적용').waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '최소 무음 길이', exact: true }).inputValue(), String(DEFAULT_SETTINGS.minSilenceMs / 1000));
    let failedAck = false;
    await page.route('**/api/ai/shares/*/resolution', async route => { if (!failedAck) { failedAck = true; await route.fulfill({ status: 503, json: { error: 'test receipt interruption' } }); } else await route.continue(); });
    await button(panel, '설정 적용').click();
    await button(panel, '검토 결과 전달 다시 시도').waitFor();
    assert.equal(await page.getByRole('spinbutton', { name: '최소 무음 길이', exact: true }).inputValue(), '0.8');
    assert.equal(await button(panel, '설정 적용').count(), 0);
    assert.equal((await setting.read()).structuredContent.status, 'proposed');
    await button(panel, '검토 결과 전달 다시 시도').click(); await panel.waitFor({ state: 'hidden' });
    await setting.receipt(['settings']); await page.unroute('**/api/ai/shares/*/resolution');
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await button(page, '전사와 자막').click(); await button(page, '현재부터 2개 AI 교정').click();
    panel = page.getByRole('dialog', { name: 'AI 자막 교정', exact: true });
    const correction = await shareTask(panel, 'correction');
    const corrections = { requestId: correction.input.requestId, changes: [{ id: 'a', before: original, after: corrected, reason: '오타 교정' }, { id: 'b', before: transcript.cues[1].text, after: '소리를 없앱니다.', reason: '검토에서 제외할 의미 변화' }] };
    await correction.send(corrections);
    await panel.getByRole('checkbox', { name: '교정 제안 1 적용 선택', exact: true }).check();
    assert.equal(await panel.getByRole('checkbox', { name: '교정 제안 2 적용 선택', exact: true }).isEnabled(), false);
    await panel.locator('.correction-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `${surface}-correction.png`) });
    if (surface === 'browser') {
      await page.setViewportSize({ width: 390, height: 844 });
      assert.equal(await panel.evaluate(e => e.scrollWidth <= e.clientWidth), true);
      await page.screenshot({ path: path.join(output, 'mobile-correction.png') }); await page.setViewportSize({ width: 1440, height: 1000 });
    }
    await button(panel, '선택한 1개 교정 적용').click(); await panel.waitFor({ state: 'hidden' });
    await correction.receipt(['a']);
    assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), corrected);
    await button(page, '자막 실행 취소').click(); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), original);
    await button(page, '자막 다시 실행').click(); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), corrected);
    await page.getByLabel('번역할 언어', { exact: true }).selectOption('ja');
    await button(page, '현재부터 2개 AI 번역').click(); panel = page.getByRole('dialog', { name: 'AI 자막 번역', exact: true });
    const translation = await shareTask(panel, 'translation'); assert.equal(translation.input.targetLanguage, 'ja');
    await translation.send({ requestId: translation.input.requestId, changes: translation.input.cues.map((cue, i) => ({ id: cue.id, before: cue.text, after: i === 0 ? '字幕です。' : '音を消しません。', reason: '고정 테스트 번역' })) });
    await panel.getByRole('checkbox', { name: '번역 제안 1 적용 선택', exact: true }).check();
    await panel.getByRole('checkbox', { name: '번역 제안 2 적용 선택', exact: true }).check();
    await button(panel, '선택한 2개 번역 적용').click(); await panel.waitFor({ state: 'hidden' }); await translation.receipt(['a', 'b']);
    assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), '字幕です。');
    await button(page, '자막 실행 취소').click(); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), corrected);
    await button(page, '자막 창 닫기').click(); await button(page, '효과음 편집').click();
    const editor = page.getByRole('dialog', { name: '효과음 편집', exact: true });
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, tone.file); await button(editor, 'beep.wav 재연결').click(); }
    else { const chooser = page.waitForEvent('filechooser'); await button(editor, 'beep.wav 재연결').click(); await (await chooser).setFiles(tone.file); }
    await editor.locator('.effects-missing.connected').waitFor();
    await button(editor, 'AI 효과음 제안').click();
    const selection = page.getByRole('dialog', { name: 'AI에 보낼 효과음 정보', exact: true });
    await selection.getByRole('checkbox', { name: 'AI 음원 1 선택', exact: true }).check();
    await selection.getByRole('checkbox', { name: 'AI 클립 1 선택', exact: true }).check();
    await button(selection, '선택 정보로 요청 준비').click();
    panel = page.getByRole('dialog', { name: 'AI 효과음 제안', exact: true });
    const effect = await shareTask(panel, 'effects');
    const changes = [{ id: 'clip-1', action: 'update', before: effect.input.clips[0], after: { ...effect.input.clips[0], start: 5, gainDb: -6 }, reason: '시작 시각과 음량 조절' }, { id: 'new-1', action: 'add', before: null, after: { ...effect.input.clips[0], id: 'new-1', start: 6 }, reason: '선택하지 않을 추가 제안' }];
    await effect.send({ requestId: effect.input.requestId, changes });
    await panel.getByRole('checkbox', { name: '효과음 제안 1 적용 선택', exact: true }).check();
    await panel.locator('.correction-review').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(output, `${surface}-effects.png`) });
    await button(panel, '선택한 1개 효과음 제안 적용').click(); await panel.waitFor({ state: 'hidden' });
    await effect.receipt(['clip-1']); await editor.waitFor();
    assert.equal(await page.getByRole('dialog', { name: '효과음 AI 대상 변경', exact: true }).count(), 0);
    assert.equal(await editor.getByRole('spinbutton', { name: '효과음 배치 시각', exact: true }).inputValue(), '5');
    await button(editor, '효과음 실행 취소').click();
    await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '4');
    assert.equal(await editor.getByRole('spinbutton', { name: '효과음 배치 시각', exact: true }).inputValue(), '4');
    await button(editor, '효과음 다시 실행').click();
    await page.waitForFunction(() => document.querySelector('[aria-label="효과음 배치 시각"]')?.value === '5');
    await button(editor, '효과음 창 닫기').click();
    async function save(control, file, notice) {
      if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await control.click(); await page.getByText(notice, { exact: true }).waitFor(); }
      else { const download = page.waitForEvent('download'); await control.click(); await (await download).saveAs(file); }
    }
    const saved = path.join(output, `${surface}-project.json`), mp4 = path.join(output, `${surface}-output.mp4`);
    await save(button(page, '프로젝트 저장').first(), saved, '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
    const stored = JSON.parse(await readFile(saved, 'utf8'));
    const expected = { ...initial, savedAt: stored.savedAt, transcript: { ...transcript, cues: transcript.cues.map((cue, i) => i ? cue : { ...cue, text: corrected }) }, effects: { ...effects, clips: effects.clips.map(c => ({ ...c, start: 5, gainDb: -6 })) } };
    assert.deepEqual(stored, expected);
    for (const secret of capabilityValues) assert.ok(!JSON.stringify(stored).includes(secret));
    await page.locator('input[type=file]').nth(1).setInputFiles(saved); await button(page, '내보내기').click(); await page.locator('.export-ready').waitFor();
    await save(button(page, '편집한 MP4 저장'), mp4, '편집한 영상을 저장했습니다.');
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', mp4, '-f', 'null', '-']);
    const raw = path.join(output, `${surface}.f32`); await capture('ffmpeg', ['-v', 'error', '-i', mp4, '-vn', '-f', 'f32le', '-c:a', 'pcm_f32le', raw]);
    const bytes = await readFile(raw);
    const rms = (a, b) => { let sum = 0; for (let i = Math.round(a * 48000); i < Math.round(b * 48000); i++) sum += bytes.readFloatLE(i * 4) ** 2; return Math.sqrt(sum / Math.round((b - a) * 48000)); };
    const updatedRMS = rms(3.1, 3.3); assert.ok(Math.abs(updatedRMS - .2 / Math.sqrt(2) * 10 ** (-6 / 20)) < .002);
    assert.equal(rms(4.1, 4.3), 0);
    assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(aiCalls, []);
    report.runs.push({ surface, status: 'PASS', tasks: ['settings', 'correction', 'translation', 'effects'], actualMCPChild: true, staleShareRevoked: true, revocationFailureAndRetry: true, duplicateProposalIdempotent: true, queuedDoesNotApply: true, receiptFailureDoesNotReapply: true, onlySelectedChangesApplied: true, negationNeedsReview: true, captionAndEffectUndoRedo: true, fullProjectRoundTrip: true, actualMP4Decoded: true, updatedEffectRMS: updatedRMS, unselectedEffectRMS: 0, errors, externalPageRequests: external, aiProviderRequests: aiCalls });
    console.log(JSON.stringify(report.runs.at(-1)));
  }
  server = await startServer({ port: 0, dataDir: path.join(output, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await page.locator('input[type=file]').first().setInputFiles(video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) {
    desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(output, 'desktop') } });
    page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await button(page, '영상 추가').click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise(page, 'desktop');
  }
  report.status = 'completed';
} catch (error) { report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally { await Promise.allSettled(clients.map(client => client.close())); await desktop?.close(); await browser?.close(); await server?.close(); await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ status: report.status, output }));
