import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SPEECH_PROTECTION, validateSpeechProtection } from '../shared/speech-settings.mjs';
import { protectSpeech, SpeechWindows } from '../shared/speech.mjs';
import { createCuts, DEFAULT_SETTINGS, intervalDuration, makeProject, validateProject } from '../shared/timeline.mjs';

test('S01: protection subtracts independent ranges and cannot increase removals', () => {
  const source = [{ start: 0, end: 10 }], voice = [{ start: 2, end: 3 }, { start: 6, end: 7 }];
  assert.deepEqual(protectSpeech(source, voice, 10), [{ start: 0, end: 2 }, { start: 3, end: 6 }, { start: 7, end: 10 }]);
  assert.deepEqual(protectSpeech(source, [{ start: 0, end: 10 }], 10), []);
  assert.deepEqual(protectSpeech([{ start: 0, end: 2 }, { start: 5, end: 8 }], [{ start: 1, end: 6 }], 10), [{ start: 0, end: 1 }, { start: 6, end: 8 }]);
  const frames = Array.from({ length: 301 }, (_, i) => i / 30);
  const cuts = createCuts(protectSpeech(source, voice, 10), DEFAULT_SETTINGS, 10, frames);
  assert.ok(intervalDuration(cuts) < intervalDuration(createCuts(source, DEFAULT_SETTINGS, 10, frames)));
  for (const cut of cuts) for (const speech of voice) assert.ok(cut.end <= speech.start || cut.start >= speech.end);
  assert.equal(createCuts(protectSpeech(source, [{ start: 0.4, end: 10 }], 10), DEFAULT_SETTINGS, 10, frames).length, 0);
});

test('S02: inclusive probability threshold preserves short speech in either channel and merges short gaps', () => {
  const windows = new SpeechWindows(0.5, 2);
  windows.push([0.49, 0.49], 0, 0.032);
  windows.push([0, 0.5], 0.032, 0.064);
  windows.push([0.9, 0], 0.192, 0.224);
  windows.push([0.9, 0], 0.5, 0.51);
  assert.deepEqual(windows.finish(0.51), [{ start: 0, end: 0.256 }, { start: 0.46799999999999997, end: 0.51 }]);
  for (const probabilities of [[], [0.7], [NaN, 0], [0, 1.1]]) assert.throws(() => windows.push(probabilities, 0, 1));
});

test('S05: old projects migrate with protection off; new projects preserve explicit settings', () => {
  const data = makeProject({ name: 'fixture.mp4', fingerprint: 'a'.repeat(64), duration: 10 }, DEFAULT_SETTINGS, 1, [{ id: 'a', start: 1, end: 2, enabled: false }], { enabled: true, threshold: 0.35 });
  assert.equal(data.version, 2);
  assert.deepEqual(validateProject(JSON.parse(JSON.stringify(data))).speechProtection, { enabled: true, threshold: 0.35 });
  const old = validateProject({ ...data, version: 1, speechProtection: undefined });
  assert.deepEqual(old.speechProtection, DEFAULT_SPEECH_PROTECTION); assert.equal(old.cuts[0].enabled, false);
  assert.throws(() => validateProject({ ...data, speechProtection: undefined }));
  for (const bad of [null, {}, { enabled: 'true', threshold: 0.5 }, { enabled: true, threshold: 0.95 }, { enabled: false, threshold: NaN }]) assert.throws(() => validateSpeechProtection(bad));
});
