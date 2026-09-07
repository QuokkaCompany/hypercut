import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { startServer } from './reference/server/app.mjs';
import { renderCaptionImages } from './reference/server/caption-rendering.mjs';
import { exportMedia, inspectMedia } from './reference/server/media.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
import { createClaudeCLI } from './reference/server/claude-cli.mjs';
import { fakeClaude } from './helpers/fake-claude.mjs';
import { capture } from './reference/server/process.mjs';
import { generateDemo } from '../scripts/fixtures.mjs';

const request = () => ({ requestId: randomUUID(), instruction: '중국어로 번역', glossary: '', targetLanguage: 'zh', cues: [{ id: 'a', text: '자동 자막입니다.' }] });
const answer = input => ({ requestId: input.requestId, changes: [{ id: 'a', before: input.cues[0].text, after: '自动生成中文字幕。', reason: '중국어 번역' }] });
async function client(server) {
  const { token } = await (await fetch(server.url + '/api/config')).json();
  return (route, body, method = body ? 'POST' : 'GET') => fetch(server.url + '/api' + route, { method, headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('translation API cancels before start, rejects late completion and retries on the selected provider (mock)', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-translation-api-')); let release, started, delay = false, calls = 0;
  const entered = new Promise(resolve => started = resolve);
  const server = await startServer({ port: 0, dataDir: directory, aiFetch: async (_url, options) => {
    calls++; const input = JSON.parse(JSON.parse(options.body).messages[0].content.split('\nRequest: ').at(-1));
    if (delay) { started(); await new Promise(resolve => release = resolve); }
    return Response.json({ done: true, message: { content: JSON.stringify(answer(input)) } });
  } });
  try {
    const call = await client(server); await call('/ai/connection', { provider: 'ollama', model: 'fixture-only' }); assert.equal(calls, 0);
    const cancelled = request(); await call('/ai/translation', { requestId: cancelled.requestId }, 'DELETE'); assert.equal((await call('/ai/translation', cancelled)).status, 400); assert.equal(calls, 0);
    assert.equal((await call('/ai/translation', { ...request(), targetLanguage: 'xx' })).status, 400); assert.equal(calls, 0);
    delay = true; const input = request(), pending = call('/ai/translation', input); await entered;
    assert.equal((await call('/ai/translation', request())).status, 400);
    await call('/ai/connection', undefined, 'DELETE'); release(); assert.equal((await pending).status, 400);
    delay = false; await call('/ai/connection', { provider: 'ollama', model: 'fixture-only' }); const fresh = request(), response = await call('/ai/translation', fresh); assert.equal(response.status, 200); assert.deepEqual(await response.json(), answer(fresh)); assert.equal(calls, 2);
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});
test('actual disposable Claude CLI translation process gets target/schema only, without media', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-translation-cli-')), fake = await fakeClaude(directory), input = request();
  await fake.set({ output: answer(input) });
  const server = await startServer({ port: 0, dataDir: directory, claudeCLI: createClaudeCLI({ executable: fake.executable }) });
  try {
    const call = await client(server); await call('/ai/connection', { provider: 'claude_cli', model: 'selected-model' });
    const response = await call('/ai/translation', { ...input, filename: 'PRIVATE.mp4' }); assert.equal(response.status, 200); assert.deepEqual(await response.json(), answer(input));
    const recorded = JSON.parse(await readFile(fake.record, 'utf8')); assert.match(recorded.input, /targetLanguage/); assert.doesNotMatch(recorded.input, /PRIVATE/); assert.equal(recorded.args[recorded.args.indexOf('--tools') + 1], '');
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});
test('all ten language samples render actual glyphs with both font weights and safe bounds', async () => {
  const samples = { ko: '자동으로 자막을 만듭니다.', en: 'Automatic video captions.', ja: '動画の字幕を自動で作成します。', zh: '自动生成中文字幕。', es: 'Edición automática de vídeo.', fr: 'Création automatique des sous-titres.', de: 'Automatische Untertitel für Videos.', pt: 'Legendas automáticas para vídeos.', it: 'Sottotitoli automatici per i video.', ru: 'Автоматические субтитры для видео.' };
  await mkdir('test-output/multilingual', { recursive: true });
  const reports = [];
  for (const [language, text] of Object.entries(samples)) for (const preset of ['clean', 'emphasis']) {
    const result = await renderCaptionImages({ mode: 'sample', language, text, width: 1280, height: 720, style: { ...DEFAULT_CAPTION_STYLE, preset } });
    assert.ok(result.layout.bounds.x >= 0 && result.layout.bounds.x + result.layout.bounds.width <= 1280);
    const bytes = Buffer.from(result.image.split(',')[1], 'base64'); assert.ok(bytes.length > 1000);
    await writeFile(`test-output/multilingual/${language}-${preset}.png`, bytes); reports.push({ language, preset, layout: result.layout, bytes: bytes.length });
  }
  await writeFile('test-output/multilingual/glyphs.json', JSON.stringify(reports, null, 2));
});
test('authenticated TXT exports preserve selected language and distinguish full/edited source; clips reject partial sentences', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-multilingual-media-'));
  const source = await generateDemo(path.join(directory, 'source.mp4')), server = await startServer({ port: 0, dataDir: path.join(directory, 'app') });
  try {
    const media = await server.registerFile(source), call = await client(server);
    const transcript = { trackIndex: 1, channel: 0, language: 'ko', outputLanguage: 'zh', model: 'manual fixture', cues: [{ id: 'a', start: 1, end: 2, text: '자동 자막입니다.', translations: { zh: { text: '自动生成中文字幕。', sourceText: '자동 자막입니다.' } } }, { id: 'b', start: 4, end: 5, text: '제외한 문장', translations: { zh: { text: '已删除的句子', sourceText: '제외한 문장' } } }] };
    const cuts = [{ start: 3, end: 6, enabled: true }];
    async function finish(body) { const r = await call('/jobs', body); assert.equal(r.status, 202); const { id } = await r.json(); for (;;) { const job = await (await call('/jobs/' + id)).json(); if (job.status !== 'running') return job; await new Promise(r => setTimeout(r, 30)); } }
    for (const textMode of ['source', 'edited']) {
      const job = await finish({ type: 'transcript', textMode, mediaId: media.id, trackIndex: 1, cuts, transcript }); assert.equal(job.status, 'completed', job.error); assert.equal(job.result.path, undefined); assert.match(job.result.name, /zh\.txt$/);
      const response = await call('/exports/' + job.result.id); assert.match(response.headers.get('content-type'), /text\/plain; charset=utf-8/);
      assert.equal(await response.text(), textMode === 'source' ? '自动生成中文字幕。\n\n已删除的句子\n' : '自动生成中文字幕。\n');
    }
    assert.equal((await call('/jobs', { type: 'transcript', textMode: 'bad', mediaId: media.id, trackIndex: 1, cuts, transcript })).status, 400);
    const item = await inspectMedia(source), captionStyle = { ...DEFAULT_CAPTION_STYLE, enabled: true };
    await assert.rejects(exportMedia(item, cuts, 1, directory, { range: { start: 1.5, end: 2.5 }, transcript, captionStyle }), /클립 경계/);
    const clip = await exportMedia(item, cuts, 1, directory, { range: { start: 1, end: 2 }, transcript, captionStyle });
    assert.equal(clip.duration, 1); assert.equal(clip.burnedCaptions, 1); assert.match(clip.name, /clip\.mp4$/);
    const metadata = JSON.parse(await capture('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-of', 'json', clip.path])); const video = metadata.streams.find(s => s.codec_type === 'video');
    assert.equal(video.width, item.width); assert.equal(video.height, item.height); assert.equal(Number(video.nb_read_frames), 30);
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', clip.path, '-f', 'null', '-']);
    await capture('ffmpeg', ['-v', 'error', '-i', clip.path, '-frames:v', '1', '-y', 'test-output/multilingual/chinese-clip.png']);
  } finally { await server.close(); await rm(directory, { recursive: true, force: true }); }
});

test('multilingual fallback is loaded only when the selected text needs it', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-font-fallback-'));
  try {
    for (const weight of ['Regular', 'Bold']) await copyFile(`assets/fonts/NotoSansKR-${weight}.otf`, path.join(directory, `NotoSansKR-${weight}.otf`));
    const input = { mode: 'sample', text: '한국어 English', width: 640, height: 360, style: DEFAULT_CAPTION_STYLE };
    assert.ok((await renderCaptionImages(input, { fontDirectory: directory })).image);
    await assert.rejects(renderCaptionImages({ ...input, text: '自动生成中文字幕。' }, { fontDirectory: directory }), /글꼴 파일/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
