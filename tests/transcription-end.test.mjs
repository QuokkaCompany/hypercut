import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseTranscription } from './reference/server/transcription.mjs';
import { captionCues } from './reference/server/caption-rendering.mjs';
import { mapCaptions, toSRT, toSourceVTT, validateTranscript } from '../shared/captions.mjs';
import { applyCaptionCorrection } from '../shared/caption-correction.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
const raw = JSON.parse(await readFile(new URL('./fixtures/whisper-end-overflow.json', import.meta.url), 'utf8'));
const media = { duration: raw.sourceDuration, fingerprint: 'a'.repeat(64), name: 'generated.mp4', audioTracks: [{ index: 1, channels: 1 }] };
const settings = { channel: 0, language: 'ko' }, kept = [{ start: 0, end: media.duration }];
const parsed = () => parseTranscription(raw, media, 1, settings);

test('real Whisper tail excerpt retains every caption and flags only the clipped 240ms ending', () => {
  const before = JSON.stringify(raw), transcript = parsed();
  assert.equal(transcript.cues.length, 5);
  for (let i = 0; i < 4; i++) { assert.equal(transcript.cues[i].end, raw.transcription[i].offsets.to / 1000); assert.equal(transcript.cues[i].timingWarning, undefined); }
  const last = transcript.cues.at(-1); assert.equal(last.start, 3596.24); assert.equal(last.end, 3600); assert.deepEqual(last.timingWarning, { kind: 'source-end', originalEnd: 3600.24 });
  assert.deepEqual(transcript.cues.map(cue => cue.text), raw.transcription.map(cue => cue.text.trim())); assert.equal(JSON.stringify(raw), before);
  assert.throws(() => toSRT(transcript, kept), /검토/); assert.throws(() => captionCues(transcript, media, 1, kept), /검토/);
});

test('end import still rejects impossible clocks, fully outside segments and overlaps', () => {
  const single = (from, to) => ({ transcription: [{ text: '문구', offsets: { from, to } }] });
  for (const [from, to] of [[3600000, 3600010], [3000000, 3600240], [3596240, 3630001], [3590000, 3630000], [-1, 1], [3596240, NaN], [3596240, 3596230]]) assert.throws(() => parseTranscription(single(from, to), media, 1, settings));
  assert.throws(() => parseTranscription({ transcription: [{ text: 'a', offsets: { from: 3590000, to: 3598000 } }, { text: 'b', offsets: { from: 3596240, to: 3600240 } }] }, media, 1, settings), /겹칩니다/);
  assert.throws(() => validateTranscript({ ...parsed(), cues: [{ ...parsed().cues[0], timingWarning: { kind: 'source-end', originalEnd: 3700 } }] }, media.duration), /검토 정보/);
});

test('source VTT remains visible for review but only explicit review permits SRT and rendering', () => {
  const transcript = parsed(), last = transcript.cues.at(-1), review = mapCaptions(transcript, kept).at(-1);
  assert.equal(review.needsReview, true); assert.match(toSourceVTT(transcript, media.duration), /00:59:56\.240 --> 01:00:00\.000/);
  const reviewed = { ...transcript, cues: transcript.cues.map(cue => cue.id === last.id ? { ...cue, reviewedFor: review.reviewKey } : cue) };
  assert.match(toSRT(reviewed, kept), /00:59:56,240 --> 01:00:00,000/); assert.equal(captionCues(reviewed, media, 1, kept).at(-1).end, 3600);
  assert.equal(mapCaptions(reviewed, [{ start: 0, end: 3598 }]).at(-1).needsReview, true);
  assert.doesNotThrow(() => toSRT(transcript, [{ start: 0, end: 3593 }])); // End caption is entirely removed.
  const input = { requestId: randomUUID(), instruction: '띄어쓰기 교정', glossary: '', cues: [{ id: last.id, text: last.text }] };
  const changed = applyCaptionCorrection(reviewed, input, { requestId: input.requestId, changes: [{ id: last.id, before: last.text, after: last.text.replace('오늘은', '오늘 은'), reason: 'fixture change' }] }, [last.id]);
  assert.deepEqual(changed.cues.at(-1).timingWarning, last.timingWarning); assert.equal(mapCaptions(changed, kept).at(-1).needsReview, true);
});

test('v7 preserves end-review state and v1-v6 keep existing cut review and glossary semantics', () => {
  const transcript = parsed(), last = transcript.cues.at(-1); last.reviewedFor = mapCaptions(transcript, kept).at(-1).reviewKey;
  const project = makeProject(media, DEFAULT_SETTINGS, 1, [], undefined, transcript, undefined, undefined, '용어');
  assert.equal(project.version, 8); const restored = validateProject(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(restored.transcript, transcript); assert.equal(mapCaptions(restored.transcript, kept).at(-1).needsReview, false);
  for (const version of [1, 2, 3, 4, 5, 6]) { const legacy = validateProject({ ...project, version }); assert.equal(legacy.version, 8); assert.equal(legacy.glossary, version < 6 ? '' : '용어'); }
  const oldCue = { id: 'old', start: 1, end: 4, text: '기존 문구', reviewedFor: JSON.stringify([1, 4, '기존 문구', [[1, 2], [3, 4]]]) };
  assert.equal(mapCaptions({ ...transcript, cues: [oldCue] }, [{ start: 0, end: 2 }, { start: 3, end: 10 }])[0].needsReview, false);
});
