import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { SilenceDetector, consumePCM } from '../server/pcm.mjs';
const detect = (samples, extra = {}) => { const detector = new SilenceDetector({ sampleRate: 1000, channels: 1, thresholdDb: 0, minSilenceMs: 50, duration: samples.length / 1000, ...extra }); detector.push(new Float32Array(samples)); return detector.finish(); };

test('D01: threshold equality, both polarities, and above threshold', () => {
  for (const level of [1, -1, 0.999]) assert.equal(detect(Array(100).fill(level)).candidates.length, 1);
  for (const level of [1.001, -1.001]) assert.equal(detect(Array(100).fill(level)).candidates.length, 0);
  // These are adjacent representable f32 values around -40 dBFS, not JS f64 comparisons.
  for (const level of [0.009999998845160007, 0.009999999776482582, -0.009999999776482582]) assert.equal(detect(Array(100).fill(level), { thresholdDb: -40 }).candidates.length, 1);
  for (const level of [0.010000000707805157, -0.010000000707805157]) assert.equal(detect(Array(100).fill(level), { thresholdDb: -40 }).candidates.length, 0);
});
test('D02: minimum length minus one, equal, plus one sample', () => {
  assert.equal(detect(Array(49).fill(0)).candidates.length, 0);
  assert.deepEqual(detect(Array(50).fill(0)).candidates, [{ start: 0, end: 0.05 }]);
  assert.deepEqual(detect(Array(51).fill(0)).candidates, [{ start: 0, end: 0.051 }]);
});
test('D03: above threshold sample breaks continuous silence', () => {
  assert.deepEqual(detect([...Array(40).fill(0), 2, ...Array(40).fill(0)]).candidates, []);
});
test('D05 regression: a final fractional audio sample is still the media end', () => {
  assert.deepEqual(detect(Array(1000).fill(0), { duration: 1.0004 }).candidates, [{ start: 0, end: 1.0004 }]);
  assert.deepEqual(detect([...Array(999).fill(0), 2], { duration: 1.0004 }).candidates, [{ start: 0, end: 0.999 }]);
});
test('D08: one active channel and opposite-phase stereo remain active', () => {
  for (const pair of [[2, 0], [0, 2], [2, -2]]) assert.deepEqual(detect(Array.from({ length: 100 }, () => pair).flat(), { channels: 2 }).candidates, []);
});
test('D13: threshold monotonicity and reproducibility', () => {
  const samples = [...Array(100).fill(0.001), ...Array(100).fill(0.03)];
  const result = detect(samples, { thresholdDb: -40 });
  assert.deepEqual(result.candidates, detect(samples, { thresholdDb: -40 }).candidates);
  assert.deepEqual(result.candidates, detect(samples, { thresholdDb: -40 }).candidates);
  assert.deepEqual(result.candidates, [{ start: 0, end: 0.1 }]);
  assert.deepEqual(detect(samples, { thresholdDb: -20 }).candidates, [{ start: 0, end: 0.2 }]);
});
test('PCM streaming survives arbitrary byte and stereo frame boundaries', async () => {
  const input = new Float32Array([0.1, -0.1, 0.2, -0.2, 0, 0]);
  const bytes = Buffer.from(input.buffer);
  const chunks = [bytes.subarray(0, 3), bytes.subarray(3, 9), bytes.subarray(9, 17), bytes.subarray(17)];
  const output = [];
  await consumePCM(Readable.from(chunks), 2, samples => output.push(...samples));
  assert.deepEqual(output, [...input]);
  await assert.rejects(consumePCM(Readable.from([Buffer.alloc(3)]), 2, () => {}));
});
