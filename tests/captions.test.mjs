import test from 'node:test';
import assert from 'node:assert/strict';
import { mapCaptions, toSRT, validateTranscript } from '../shared/captions.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { parseTranscription, validateTranscriptionSettings } from '../server/transcription.mjs';
const source = { trackIndex: 1, channel: 0, language: 'ko', model: 'fixture', cues: [{ id: 'a', start: 5, end: 6.2, text: '한글 자막' }] };
const kept = [{ start: 0, end: 2 }, { start: 4, end: 8 }, { start: 9, end: 12 }];
test('C01: source captions map to independently specified edited timestamps and restore reversibly', () => {
  const result = mapCaptions(source, kept)[0]; assert.equal(result.outputStart, 3); assert.ok(Math.abs(result.outputEnd - 4.2) < 1e-12); assert.equal(result.needsReview, false);
  assert.equal(toSRT(source, kept), '1\n00:00:03,000 --> 00:00:04,200\n한글 자막\n');
  assert.equal(mapCaptions(source, [{ start: 0, end: 12 }])[0].outputStart, 5);
  assert.equal(source.cues[0].start, 5);
});
test('C02: partially cut captions require text-specific review and never duplicate a sentence', () => {
  const input = { ...source, cues: [{ id: 'cross', start: 1.5, end: 4.5, text: '남길 말' }, { id: 'gone', start: 8.1, end: 8.9, text: '지운 말' }] };
  let mapped = mapCaptions(input, kept); assert.equal(mapped[0].needsReview, true); assert.equal(mapped[1].removed, true);
  assert.throws(() => toSRT(input, kept), /검토/);
  input.cues[0].reviewedFor = mapped[0].reviewKey;
  assert.equal(toSRT(input, kept), '1\n00:00:01,500 --> 00:00:02,500\n남길 말\n');
  input.cues[0].text = '바꾼 말'; assert.equal(mapCaptions(input, kept)[0].needsReview, true);
  input.cues[0].text = '남길 말'; assert.equal(mapCaptions(input, [{ start: 0, end: 1.9 }, ...kept.slice(1)])[0].needsReview, true);
});
test('C04: v1/v2 migration clears unavailable captions and v3 preserves text and cut reviews', () => {
  const project = makeProject({ name: 'fixture.mp4', fingerprint: 'a'.repeat(64), duration: 12 }, DEFAULT_SETTINGS, 1, [{ id: 'cut', start: 2, end: 4, enabled: false }], { enabled: true, threshold: .4 }, source);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))).transcript, source);
  for (const version of [1, 2]) { const restored = validateProject({ ...project, version }); assert.equal(restored.transcript, null); assert.equal(restored.cuts[0].enabled, false); }
  assert.throws(() => validateProject({ ...project, transcript: undefined }), /자막/);
  for (const bad of [{ ...source, cues: [...source.cues, ...source.cues] }, { ...source, cues: [{ ...source.cues[0], end: 13 }] }, { ...source, cues: [{ ...source.cues[0], text: '\0' }] }, { ...source, channel: 8 }, { ...source, cues: [source.cues[0], { id: 'b', start: 6, end: 7, text: '겹침' }] }]) assert.throws(() => validateTranscript(bad, 12));
});
test('C05: SRT keeps Unicode, escapes markup, rounds ms and refuses empty output', () => {
  const input = { ...source, cues: [{ id: 'a', start: 1.0004, end: 2.0004, text: '<b>문구</b> &\n다음 줄' }] };
  assert.equal(toSRT(input, [{ start: 0, end: 12 }]), '1\n00:00:01,000 --> 00:00:02,000\n&lt;b&gt;문구&lt;/b&gt; &amp;\n다음 줄\n');
  assert.throws(() => toSRT(input, []), /없습니다/);
});
test('T03/T06: engine output and channel contracts reject corrupt or out-of-range data', () => {
  const media = { duration: 12, audioTracks: [{ index: 1, channels: 2 }] };
  assert.deepEqual(validateTranscriptionSettings({ channel: 1, language: 'ko' }, media, 1), { channel: 1, language: 'ko' });
  for (const settings of [{ channel: 2, language: 'ko' }, { channel: 0, language: 'bad' }]) assert.throws(() => validateTranscriptionSettings(settings, media, 1));
  const parsed = parseTranscription({ transcription: [{ text: '첫 문장', offsets: { from: 1000, to: 2000 } }] }, media, 1, { channel: 1, language: 'ko' });
  assert.equal(parsed.cues[0].start, 1); assert.equal(parsed.cues[0].end, 2);
  for (const output of [{}, { transcription: [{ text: '문구', offsets: { from: 1000, to: NaN } }] }, { transcription: [{ text: '문구', offsets: { from: 1000, to: 15000 } }] }]) assert.throws(() => parseTranscription(output, media, 1, { channel: 0, language: 'ko' }));
});
