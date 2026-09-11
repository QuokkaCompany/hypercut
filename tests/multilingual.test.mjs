import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CAPTION_LANGUAGES } from '../shared/languages.mjs';
import { validateTranscript, mapCaptions, toSRT, toTranscriptText, editCaptionContent } from '../shared/captions.mjs';
import { validateTranslationRequest, validateTranslationProposal, applyCaptionTranslation } from '../shared/caption-translation.mjs';
import { validateTranscriptionSettings, parseTranscription } from './reference/server/transcription.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { askCaptionTranslation } from './reference/server/ai.mjs';
import { createShareStore } from './reference/server/mcp-shares.mjs';

const media = { name: 'source.mp4', duration: 10, fingerprint: 'a'.repeat(64), audioTracks: [{ index: 1, channels: 1 }] };
const original = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual', cues: [{ id: 'a', start: 1, end: 2, text: '영상 2개입니다.' }, { id: 'b', start: 4, end: 5, text: '지우지 마세요.' }] };
const input = { requestId: randomUUID(), instruction: '번역해 주세요.', glossary: '', targetLanguage: 'zh', cues: original.cues.map(({ id, text }) => ({ id, text })) };
const proposal = { requestId: input.requestId, changes: [{ id: 'a', before: original.cues[0].text, after: '这是两个视频。', reason: '중국어 번역' }, { id: 'b', before: original.cues[1].text, after: '请不要删除。', reason: '부정 의미 유지' }] };
const full = [{ start: 0, end: 10 }];
test('10 transcription languages and auto validate; unknown codes and channels reject', () => {
  assert.equal(CAPTION_LANGUAGES.length, 10);
  for (const language of [...CAPTION_LANGUAGES.map(l => l.code), 'auto']) {
    assert.equal(validateTranscriptionSettings({ language, channel: 0 }, media, 1).language, language);
    assert.equal(validateTranscript({ ...original, language }, 10).language, language);
  }
  for (const language of ['xx', 'EN', '', null]) assert.throws(() => validateTranscriptionSettings({ language, channel: 0 }, media, 1));
  assert.throws(() => validateTranscriptionSettings({ language: 'ja', channel: 1 }, media, 1));
});
test('translation preserves source text and timing, round trips v8 and all v1-v7 imports', () => {
  const before = structuredClone(original), translated = applyCaptionTranslation(original, input, proposal, ['a', 'b']);
  assert.deepEqual(original, before); assert.deepEqual(translated.cues.map(({ id, text, start, end }) => ({ id, text, start, end })), original.cues);
  assert.equal(toTranscriptText(translated, full), '这是两个视频。\n\n请不要删除。\n');
  assert.equal(toSRT(translated, full), '1\n00:00:01,000 --> 00:00:02,000\n这是两个视频。\n\n2\n00:00:04,000 --> 00:00:05,000\n请不要删除。\n');
  const project = makeProject(media, DEFAULT_SETTINGS, 1, [], undefined, translated);
  assert.equal(project.version, 9); assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))).transcript, validateTranscript(translated, 10));
  for (const version of [1, 2, 3, 4, 5, 6, 7]) assert.equal(validateProject({ ...project, version }).version, 9);
});
test('missing and stale translations cannot be acknowledged into exports; original remains recoverable', () => {
  const partial = applyCaptionTranslation(original, input, proposal, ['a']);
  assert.throws(() => toSRT(partial, full)); assert.throws(() => toTranscriptText(partial, full, { source: true }));
  // Removed, untranslated cues need not prevent an edited-language export.
  assert.equal(toTranscriptText(partial, [{ start: 0, end: 3 }]), '这是两个视频。\n');
  const stale = { ...partial, cues: partial.cues.map(c => c.id === 'a' ? editCaptionContent(c, undefined, '영상 3개입니다.') : c) };
  const mapped = mapCaptions(stale, full); stale.cues[0].reviewedFor = mapped[0].reviewKey;
  assert.equal(mapCaptions(stale, full)[0].needsReview, true); assert.throws(() => toTranscriptText(stale, [{ start: 0, end: 3 }]));
  assert.equal(toTranscriptText({ ...stale, outputLanguage: undefined }, full), '영상 3개입니다.\n\n지우지 마세요.\n');
  assert.throws(() => applyCaptionTranslation(stale, input, proposal, ['a']), /원문이 변경/);
});
test('TXT distinguishes all source sentences and reviewed edited sentences with UTF-8 literal text', () => {
  const edited = [{ start: 0, end: 1.5 }, { start: 3, end: 10 }];
  assert.equal(toTranscriptText(original, edited, { source: true }), '영상 2개입니다.\n\n지우지 마세요.\n');
  assert.throws(() => toTranscriptText(original, edited), /경계/);
  const reviewed = structuredClone(original); reviewed.cues[0].reviewedFor = mapCaptions(reviewed, edited)[0].reviewKey;
  assert.equal(toTranscriptText(reviewed, edited), '영상 2개입니다.\n\n지우지 마세요.\n');
  assert.throws(() => toTranscriptText(original, []), /남은 대본/);
});
test('translation rejects incomplete, duplicate, stale, extra or malformed responses; identical translated text is valid', () => {
  for (const p of [ { ...proposal, requestId: randomUUID() }, { ...proposal, changes: proposal.changes.slice(0, 1) }, { ...proposal, changes: [proposal.changes[0], proposal.changes[0]] }, { ...proposal, execute: 'something' }, { ...proposal, changes: proposal.changes.map(c => ({ ...c, start: 0 })) }, { ...proposal, changes: proposal.changes.map(c => ({ ...c, before: 'unshared' })) } ]) assert.throws(() => validateTranslationProposal(p, input));
  assert.throws(() => validateTranslationRequest({ ...input, targetLanguage: 'xx' }));
  assert.throws(() => validateTranslationRequest({ ...input, cues: Array.from({ length: 21 }, (_, i) => ({ id: String(i), text: 'a' })) }));
  assert.throws(() => validateTranslationRequest({ ...input, cues: Array.from({ length: 3 }, (_, i) => ({ id: String(i), text: 'a'.repeat(1500) })) }));
  const identity = { ...proposal, changes: proposal.changes.map(c => ({ ...c, after: c.before })) };
  assert.equal(validateTranslationProposal(identity, input).changes.length, 2);
});
for (const provider of ['ollama', 'openai', 'anthropic']) test(`${provider} translation sends only selected text/target/model (mock)`, async () => {
  let calls = 0;
  const result = await askCaptionTranslation({ provider, model: 'selected-model', apiKey: 'test-only', baseURL: 'http://127.0.0.1:11434' }, { ...input, filename: 'PRIVATE.mp4', cues: original.cues }, { fetchImpl: async (_url, options) => {
    calls++; const b = JSON.parse(options.body); assert.equal(b.model, 'selected-model');
    const text = JSON.stringify(b); assert.match(text, /targetLanguage/); assert.match(text, /zh/); assert.doesNotMatch(text, /PRIVATE|"start"|"end"/);
    return Response.json(provider === 'ollama' ? { done: true, message: { content: JSON.stringify(proposal) } } : provider === 'openai' ? { status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] } : { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(proposal) }] });
  } }); assert.equal(calls, 1); assert.deepEqual(result, proposal);
});
test('MCP translation carries target language and queues review without applying or exposing media', () => {
  const store = createShareStore(), share = store.create({ task: 'translation', request: { ...input, filename: 'PRIVATE.mp4' } });
  const context = store.read(share.shareId, share.capability); assert.equal(context.task, 'translation'); assert.equal(context.context.request.targetLanguage, 'zh'); assert.doesNotMatch(JSON.stringify(context), /PRIVATE/);
  const value = { contextVersion: share.contextVersion, proposalId: randomUUID(), proposal };
  assert.equal(store.submit(share.shareId, share.capability, value).status, 'proposed'); assert.deepEqual(original.cues[0].translations, undefined);
  assert.equal(store.resolve(share.shareId, { contextVersion: share.contextVersion, proposalId: value.proposalId, outcome: 'applied', selectedIds: ['a'] }).status, 'applied');
});
