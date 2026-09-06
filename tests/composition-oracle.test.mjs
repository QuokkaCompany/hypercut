import test from 'node:test';
import assert from 'node:assert/strict';
import { compositionData, expectedComposition, verifyCompositionSRT, CompositionAudioOracle, CompositionCaptionOracle } from '../scripts/helpers/composition-oracle.mjs';

const asset = { id: 'a'.repeat(64), fingerprint: 'a'.repeat(64), name: 'composition.wav', duration: .5 };
const cuts = [{ start: 2.8, end: 3.5, enabled: true }, { start: 6.4, end: 7.1, enabled: true }];

test('composition fixture has distinct long-video cues, distributed effects and excluded controls', () => {
  const long = compositionData(3600, asset);
  assert.equal(long.transcript.cues.length, 1000); assert.equal(long.effects.clips.length, 66);
  assert.equal(long.transcript.cues.at(-1).text, '합성 검증 1000');
  assert.equal(new Set(long.effects.clips.slice(0, 64).map(c => c.start)).size, 64);
  const data = compositionData(7.2, asset), expected = expectedComposition(7.2, cuts, data);
  assert.ok(Math.abs(expected.duration - 5.8) < 1e-9);
  assert.deepEqual(expected.excludedEffects, [{ id: 'muted-control', reason: 'muted' }, { id: 'removed-control', reason: 'removed' }]);
  assert.ok(Math.abs(expected.captions[1].start - 3.7) < 1e-9);
  assert.ok(Math.abs(expected.effects[1].start - 4.5) < 1e-9);
  assert.throws(() => expectedComposition(7.2, [{ start: 1, end: 2, enabled: true }], data), /caption intersects/);
});

test('independent SRT checker rejects missing, wrong-text and shifted cues', () => {
  const expected = [{ text: '한글 0001', start: .8, end: 2.2 }, { text: '한글 0002', start: 3.7, end: 5.1 }];
  const valid = '1\n00:00:00,800 --> 00:00:02,200\n한글 0001\n\n2\n00:00:03,700 --> 00:00:05,100\n한글 0002\n';
  assert.equal(verifyCompositionSRT(valid, expected).cues, 2);
  assert.throws(() => verifyCompositionSRT(valid.split('\n\n')[0], expected), /cue count/);
  assert.throws(() => verifyCompositionSRT(valid.replace('한글 0002', '다른 문구'), expected), /SRT text/);
  assert.throws(() => verifyCompositionSRT(valid.replace('03,700', '03,900'), expected), /SRT clock/);
});

const audioExpected = { duration: 3, effects: [{ id: 'audible', start: 1, end: 1.25, amplitude: .05 }] };
function audio({ start = 1, end = 1.25, gain = .05, extra = false, truncate = false } = {}) {
  const oracle = new CompositionAudioOracle(audioExpected);
  const count = (truncate ? 2 : 3) * 48000;
  for (let n = 0; n < count; n++) {
    const t = n / 48000, effect = t >= start && t < end ? gain * Math.sin(2 * Math.PI * 880 * t) : 0;
    const unexpected = extra && t >= 2 && t < 2.25 ? .05 * Math.sin(2 * Math.PI * 880 * t) : 0;
    oracle.sample(.15 * Math.sin(2 * Math.PI * 440 * t) + effect + unexpected);
  }
  return oracle.finish();
}
test('streaming spectral oracle distinguishes the expected effect from the source tone', () => {
  const result = audio(); assert.equal(result.events.length, 1); assert.ok(result.events[0].centers >= 30); assert.ok(result.peak < .21);
});
test('spectral oracle rejects absent, shifted, shortened, wrong-gain, extra and truncated audio', () => {
  assert.throws(() => audio({ gain: 0 }), /Effect gain|Missing effect/);
  assert.throws(() => audio({ start: 1.2, end: 1.45 }), /Effect gain|Unexpected effect|boundary/);
  assert.throws(() => audio({ end: 1.12 }), /Effect gain|boundary/);
  assert.throws(() => audio({ gain: .025 }), /Effect gain/);
  assert.throws(() => audio({ extra: true }), /Unexpected effect/);
  assert.throws(() => audio({ truncate: true }), /audio duration/);
});

const captionExpected = { duration: 3, captions: [{ id: 'one', start: .8, end: 2.2 }] };
function captions({ shift = 0, missing = false, extra = false, omittedFrame = false } = {}) {
  const oracle = new CompositionCaptionOracle(captionExpected);
  for (let i = 0; i < 90; i++) {
    if (omittedFrame && i === 5) continue;
    const t = i / 30, on = !missing && t >= .8 + shift && t < 2.2 + shift;
    oracle.frame(t, on || (extra && t < .5) ? 20 : 0);
  }
  return oracle.finish();
}
test('caption oracle checks every frame and rejects missing, shifted, extra and dropped frames', () => {
  assert.equal(captions().frames, 90);
  assert.throws(() => captions({ missing: true }), /Caption presence|Missing caption/);
  assert.throws(() => captions({ shift: .2 }), /Caption presence/);
  assert.throws(() => captions({ extra: true }), /Caption presence/);
  assert.throws(() => captions({ omittedFrame: true }), /frame count/);
});
