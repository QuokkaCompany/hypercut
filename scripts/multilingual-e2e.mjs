import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../tests/reference/server/app.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { capture } from '../tests/reference/server/process.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-multilingual-ui-'));
const artifact = path.resolve(`test-output/multilingual-ui-${Date.now()}`), results = [];
const original = ['자동으로 자막을 만듭니다.', '삭제한 문장입니다.', '영상 편집을 시작합니다.'];
const translated = ['自动生成中文字幕。', '这是删除的句子。', '开始编辑视频。'];
const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual test fixture', cues: original.map((text, i) => ({ id: `cue-${i}`, start: [1, 3.5, 7][i], end: [2, 4.5, 8][i], text })) };
let browser, desktop, server, page;
try {
  await mkdir(artifact, { recursive: true });
  const video = await generateDemo(path.join(directory, 'fixture.mp4')), media = await inspectMedia(video), projectPath = path.join(directory, 'fixture.hypercut.json');
  await writeFile(projectPath, JSON.stringify(makeProject(media, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 3, end: 5, enabled: true }], undefined, transcript, { ...DEFAULT_CAPTION_STYLE, enabled: true })));
  async function exercise(surface) {
    console.log(`${surface}: begin`);
    const errors = [], external = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(r.url())) external.push(r.url()); });
    const button = name => page.getByRole('button', { name, exact: true });
    async function save(name, file, notice) {
      if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, file); await button(name).first().click(); await page.getByText(notice, { exact: true }).waitFor(); }
      else { const download = page.waitForEvent('download'); await button(name).first().click(); await (await download).saveAs(file); }
      for (let i = 0; i < 100 && !(await readFile(file).catch(() => null)); i++) await new Promise(r => setTimeout(r, 50));
      assert.ok((await readFile(file)).length > 0);
      await page.waitForFunction(() => !document.querySelector('.caption-progress'));
    }
    await page.locator('input[type=file]').nth(1).setInputFiles(projectPath); await page.waitForFunction(() => !document.querySelector('.unsaved-dot'));
    await button('전사와 자막').click();
    assert.equal(await page.getByLabel('전사 언어', { exact: true }).locator('option').count(), 11);
    for (const code of ['ja', 'zh', 'es', 'fr', 'de', 'pt', 'it', 'ru', 'en', 'auto']) { await page.getByLabel('전사 언어', { exact: true }).selectOption(code); assert.equal(await page.getByLabel('전사 언어', { exact: true }).inputValue(), code); }
    await page.getByLabel('번역할 언어', { exact: true }).selectOption('zh'); await button('현재부터 3개 AI 번역').click(); await page.getByRole('dialog', { name: 'AI 자막 번역', exact: true }).waitFor();
    await button('AI에게 보낼 요청 복사').click(); await page.getByText('보낼 요청 보기', { exact: true }).click();
    const prompt = await page.getByRole('textbox', { name: '복사용 AI 요청' }).inputValue(), input = JSON.parse(prompt.split('\nRequest: ').at(-1));
    assert.equal(input.targetLanguage, 'zh'); assert.equal(input.cues.length, 3); assert.doesNotMatch(prompt, /fixture\.mp4|"start"|"end"/);
    const proposal = { requestId: input.requestId, changes: input.cues.map((c, i) => ({ id: c.id, before: c.text, after: translated[i], reason: '고정된 테스트 번역문' })) };
    const response = page.getByRole('textbox', { name: 'AI JSON 응답' });
    await response.fill(JSON.stringify({ ...proposal, changes: proposal.changes.slice(0, 1) })); await button('응답 확인').click(); await page.getByRole('alert').filter({ hasText: '모든 자막' }).waitFor();
    await response.fill(JSON.stringify(proposal)); await button('응답 확인').click();
    for (let i = 1; i <= 3; i++) await page.getByRole('checkbox', { name: `번역 제안 ${i} 적용 선택`, exact: true }).check();
    await page.screenshot({ path: path.join(artifact, `${surface}-translation.png`) });
    await button('선택한 3개 번역 적용').click();
    assert.equal(await page.getByLabel('출력 자막 언어', { exact: true }).inputValue(), 'zh'); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), translated[0]);
    await button('자막 실행 취소').click(); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), original[0]);
    await button('자막 다시 실행').click(); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), translated[0]);
    // Changing source invalidates its translation and cannot silently export it.
    await page.getByLabel('출력 자막 언어', { exact: true }).selectOption('source'); await page.getByRole('textbox', { name: '자막 문구', exact: true }).fill('변경된 원문입니다.'); await button('자막 수정 적용').click();
    await page.getByLabel('출력 자막 언어', { exact: true }).selectOption('zh'); assert.equal(await button('편집한 SRT 저장').isEnabled(), false); assert.equal(await button('전체 대본 TXT 저장').isEnabled(), false);
    await button('자막 실행 취소').click(); await button('자막 실행 취소').click(); await page.getByLabel('출력 자막 언어', { exact: true }).selectOption('zh');
    const fullText = path.join(artifact, `${surface}-full-zh.txt`), editedText = path.join(artifact, `${surface}-edited-zh.txt`), srt = path.join(artifact, `${surface}-zh.srt`);
    await save('전체 대본 TXT 저장', fullText, '대본 TXT를 저장했습니다.'); assert.equal(await readFile(fullText, 'utf8'), translated.join('\n\n') + '\n');
    await save('편집한 대본 TXT 저장', editedText, '대본 TXT를 저장했습니다.'); assert.equal(await readFile(editedText, 'utf8'), `${translated[0]}\n\n${translated[2]}\n`);
    await save('편집한 SRT 저장', srt, '편집한 자막을 저장했습니다.'); assert.equal(await readFile(srt, 'utf8'), `1\n00:00:01,000 --> 00:00:02,000\n${translated[0]}\n\n2\n00:00:05,000 --> 00:00:06,000\n${translated[2]}\n`);
    // A translated edit changes only the translated layer.
    await page.getByRole('textbox', { name: '자막 문구', exact: true }).fill('自动添加字幕。'); await button('자막 수정 적용').click();
    await page.getByLabel('출력 자막 언어', { exact: true }).selectOption('source'); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), original[0]);
    await button('자막 실행 취소').click(); await button('자막 실행 취소').click();
    await page.getByRole('img', { name: '선택한 자막 디자인 미리보기' }).waitFor(); await page.screenshot({ path: path.join(artifact, `${surface}-captions.png`) });
    if (surface === 'browser') { await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(artifact, 'mobile.png') }); const box = await page.getByRole('dialog', { name: '전사와 자막 편집' }).boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390); await page.setViewportSize({ width: 1440, height: 1000 }); }
    await page.getByLabel('클립 마지막 문장', { exact: true }).selectOption('cue-2'); await button('선택 문장으로 클립 만들기').click();
    assert.equal(await page.getByLabel('클립 시작 (초)', { exact: true }).inputValue(), '1'); assert.equal(await page.getByLabel('클립 끝 (초)', { exact: true }).inputValue(), '8');
    await button('클립 MP4 만들기').click(); await button('클립 MP4 저장').waitFor();
    assert.match(await page.locator('.export-ready').innerText(), /자막 2개 포함/);
    const clip = path.join(artifact, `${surface}-clip.mp4`); await save('클립 MP4 저장', clip, '편집한 영상을 저장했습니다.');
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', clip, '-f', 'null', '-']); const info = await inspectMedia(clip); assert.equal(info.duration, 5); assert.equal(info.width, media.width);
    await capture('ffmpeg', ['-v', 'error', '-i', clip, '-frames:v', '1', '-y', path.join(artifact, `${surface}-clip.png`)]);
    // Arbitrary time selection without mutating the saved project cuts.
    await button('클립 만들기').click(); await page.getByLabel('클립 시작 (초)', { exact: true }).fill('9'); await page.getByLabel('클립 끝 (초)', { exact: true }).fill('10.25'); await button('클립 MP4 만들기').click(); await button('클립 MP4 저장').waitFor();
    const arbitrary = path.join(artifact, `${surface}-arbitrary.mp4`); await save('클립 MP4 저장', arbitrary, '편집한 영상을 저장했습니다.'); const arbitraryInfo = await inspectMedia(arbitrary); assert.ok(Math.abs(arbitraryInfo.duration - 1.266667) < .001); await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', arbitrary, '-f', 'null', '-']);
    const saved = path.join(artifact, `${surface}.hypercut.json`); await save('프로젝트 저장', saved, '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
    const stored = JSON.parse(await readFile(saved, 'utf8')); assert.equal(stored.version, 8); assert.equal(stored.transcript.outputLanguage, 'zh'); assert.deepEqual(stored.cuts.map(({ start, end }) => [start, end]), [[3, 5]]);
    assert.deepEqual(stored.transcript.cues.map(c => c.text), original); assert.deepEqual(stored.transcript.cues.map(c => c.translations.zh.text), translated);
    await page.locator('input[type=file]').nth(1).setInputFiles(saved); await button('전사와 자막').click(); assert.equal(await page.getByLabel('출력 자막 언어', { exact: true }).inputValue(), 'zh'); assert.equal(await page.getByRole('textbox', { name: '자막 문구', exact: true }).inputValue(), translated[0]);
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    results.push({ surface, status: 'PASS', inference: 'Manual fixed JSON only; no model or human-quality evaluation', originalPreserved: true, sourceEditInvalidatesTranslation: true, translationEditPreservesSource: true, undoRedo: true, projectV8RoundTrip: true, languageOptions: 11, utf8TXTandSRT: true, sentenceClipSeconds: info.duration, arbitraryClipSeconds: arbitraryInfo.duration, originalDimensions: true, actualMP4Decode: true, saveDialog: surface === 'desktop' ? 'Controlled destination through native save IPC, not OS dialog interaction' : 'Actual browser downloads', externalRequests: external.length });
    console.log(`${surface}: PASS`);
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'browser') }); browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await page.locator('input[type=file]').first().setInputFiles(video); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise('browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) { desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } }); page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, video); await page.getByRole('button', { name: '영상 추가', exact: true }).click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2); await exercise('desktop'); }
  assert.equal((await inspectMedia(video)).fingerprint, media.fingerprint);
} catch (error) { await page?.screenshot({ path: path.join(artifact, 'failure.png') }).catch(() => {}); throw error; }
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); await writeFile(path.join(artifact, 'results.json'), JSON.stringify(results, null, 2)); console.log(artifact); }
