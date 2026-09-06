import assert from 'node:assert/strict';

export const COMPOSITION_TONE = Object.freeze({ rate: 48000, frequency: 880, amplitude: .1, seconds: .5 });
export const COMPOSITION_STYLE = Object.freeze({ enabled: true, preset: 'emphasis', sizePercent: 4.5, position: 'bottom', marginPercent: 8 });

export function compositionData(duration, asset, trackIndex = 1) {
  const cycles = Math.floor(duration / 3.6);
  assert.ok(cycles >= 2 && cycles <= 1000);
  const cues = Array.from({ length: cycles }, (_, i) => ({ id: `caption-${i}`, start: i * 3.6 + .8, end: i * 3.6 + 2.2, text: `합성 검증 ${String(i + 1).padStart(4, '0')}` }));
  const count = Math.min(64, cycles), indexes = Array.from({ length: count }, (_, i) => Math.round(i * (cycles - 1) / (count - 1)));
  assert.equal(new Set(indexes).size, count);
  const clip = (id, start, muted = false) => ({ id, assetId: asset.id, start, offset: .02, duration: .25, gainDb: -6, muted });
  return {
    transcript: { trackIndex, channel: 0, language: 'ko', model: 'manual synthetic composition fixture', cues },
    captionStyle: { ...COMPOSITION_STYLE },
    effects: { assets: [{ id: asset.id, fingerprint: asset.fingerprint, name: asset.name, duration: asset.duration }], clips: [...indexes.map((i, n) => clip(`effect-${n}`, i * 3.6 + 1.6)), clip('muted-control', .9, true), clip('removed-control', 3.1)] }
  };
}

// Expected timing uses only interval arithmetic, never the application's mapper.
export function expectedComposition(duration, cuts, data) {
  const removals = cuts.filter(c => c.enabled).map(c => ({ start: c.start, end: c.end })).sort((a, b) => a.start - b.start);
  let end = 0;
  for (const cut of removals) { assert.ok(Number.isFinite(cut.start) && Number.isFinite(cut.end) && cut.start >= end && cut.end > cut.start && cut.end <= duration); end = cut.end; }
  const map = time => time - removals.reduce((sum, cut) => sum + Math.max(0, Math.min(time, cut.end) - cut.start), 0);
  const outputDuration = map(duration);
  const captions = data.transcript.cues.map(cue => {
    assert.ok(!removals.some(cut => cut.start < cue.end && cut.end > cue.start), `Fixture caption intersects a removal: ${cue.id}`);
    return { id: cue.id, text: cue.text, start: map(cue.start), end: map(cue.end) };
  });
  const effects = [], excludedEffects = [];
  for (const clip of data.effects.clips) {
    const removed = removals.some(cut => clip.start >= cut.start && clip.start < cut.end);
    if (clip.muted || removed) { excludedEffects.push({ id: clip.id, reason: clip.muted ? 'muted' : 'removed' }); continue; }
    const asset = data.effects.assets.find(a => a.id === clip.assetId); assert.ok(asset);
    const start = map(clip.start), end = Math.min(outputDuration, start + clip.duration, start + asset.duration - clip.offset);
    assert.ok(end > start);
    effects.push({ id: clip.id, start, end, amplitude: COMPOSITION_TONE.amplitude * 32767 / 32768 * 10 ** (clip.gainDb / 20) });
  }
  effects.sort((a, b) => a.start - b.start);
  for (let i = 1; i < effects.length; i++) assert.ok(effects[i].start > effects[i - 1].end + .1, 'Oracle fixtures must not overlap effects');
  return { duration: outputDuration, captions, effects, excludedEffects };
}

export function verifyCompositionSRT(text, expected) {
  const blocks = text.replace(/\r/g, '').trim().split(/\n\s*\n/);
  assert.equal(blocks.length, expected.length, 'SRT cue count');
  const stamp = value => {
    const m = /^(\d{2,}):(\d{2}):(\d{2}),(\d{3})$/.exec(value); assert.ok(m, `SRT timestamp: ${value}`);
    assert.ok(Number(m[2]) < 60 && Number(m[3]) < 60);
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
  };
  let maxError = 0;
  blocks.forEach((block, i) => {
    const [index, interval, ...body] = block.split('\n'), times = interval?.split(' --> ');
    assert.equal(index, String(i + 1)); assert.equal(times?.length, 2);
    assert.equal(body.join('\n'), expected[i].text, `SRT text ${i + 1}`);
    for (const [value, target] of [[times[0], expected[i].start], [times[1], expected[i].end]]) { const error = Math.abs(stamp(value) - target); assert.ok(error <= .001 + 1e-9, `SRT clock ${i + 1}`); maxError = Math.max(maxError, error); }
  });
  return { cues: blocks.length, maxErrorSeconds: maxError };
}

// Bounded Hann-window detector. 880 Hz effects are distinct from the 440 Hz source.
export class CompositionAudioOracle {
  constructor(expected) {
    this.expected = expected; this.rate = 48000; this.window = 960; this.hop = 240; this.tolerance = 1 / 30;
    this.ring = new Float64Array(this.window); this.cos = new Float64Array(this.window); this.sin = new Float64Array(this.window);
    this.weight = 0; this.frames = 0; this.peak = 0; this.index = 0;
    this.events = expected.effects.map(effect => ({ ...effect, first: null, last: null, centers: 0, minAmplitude: Infinity, maxAmplitude: 0 }));
    for (let i = 0; i < this.window; i++) { const w = .5 * (1 - Math.cos(2 * Math.PI * i / (this.window - 1))), angle = 2 * Math.PI * 880 * i / this.rate; this.weight += w; this.cos[i] = w * Math.cos(angle); this.sin[i] = w * Math.sin(angle); }
  }
  sample(value) {
    assert.ok(Number.isFinite(value), 'Non-finite decoded audio');
    this.peak = Math.max(this.peak, Math.abs(value)); this.ring[this.frames % this.window] = value; this.frames++;
    if (this.frames < this.window || this.frames % this.hop) return;
    let real = 0, imaginary = 0;
    const oldest = this.frames % this.window;
    for (let i = 0; i < this.window; i++) { const sample = this.ring[(oldest + i) % this.window]; real += sample * this.cos[i]; imaginary += sample * this.sin[i]; }
    const time = (this.frames - this.window / 2) / this.rate, amplitude = 2 * Math.hypot(real, imaginary) / this.weight;
    while (this.index < this.events.length && time > this.events[this.index].end + this.tolerance) this.index++;
    const event = this.events[this.index], inside = event && time >= event.start - this.tolerance;
    if (amplitude >= .012) {
      assert.ok(inside, `Unexpected effect at ${time.toFixed(3)}s: ${amplitude.toFixed(5)}`);
      event.first ??= time; event.last = time;
    }
    if (event && time >= event.start + .04 && time <= event.end - .04) {
      assert.ok(Math.abs(amplitude - event.amplitude) <= .006, `Effect gain ${event.id} at ${time.toFixed(3)}s: ${amplitude.toFixed(5)}`);
      event.centers++; event.minAmplitude = Math.min(event.minAmplitude, amplitude); event.maxAmplitude = Math.max(event.maxAmplitude, amplitude);
    }
  }
  finish() {
    assert.ok(Math.abs(this.frames / this.rate - this.expected.duration) <= this.tolerance + 1e-9, 'Decoded audio duration');
    assert.ok(this.peak <= 1, 'Clipped output audio');
    for (const event of this.events) {
      assert.ok(event.centers >= 10, `Missing effect center: ${event.id}`);
      assert.ok(event.first !== null && event.last !== null, `Missing effect: ${event.id}`);
      assert.ok(Math.abs(event.first - event.start) <= this.tolerance && Math.abs(event.last + this.hop / 2 / this.rate - event.end) <= this.tolerance, `Effect boundary: ${event.id}`);
    }
    return { frames: this.frames, peak: this.peak, toleranceSeconds: this.tolerance, amplitudeTolerance: .006, events: this.events };
  }
}

export class CompositionCaptionOracle {
  constructor(expected) { this.expected = expected; this.index = 0; this.frames = 0; this.lastTime = -1; this.visibleFrames = new Array(expected.captions.length).fill(0); this.boundaryFrames = 0; }
  frame(time, yellowPixels) {
    assert.ok(Number.isFinite(time) && time > this.lastTime, 'Video timestamps must increase'); this.lastTime = time; this.frames++;
    while (this.index < this.expected.captions.length && time >= this.expected.captions[this.index].end) this.index++;
    const cue = this.expected.captions[this.index], previous = this.expected.captions[this.index - 1];
    const should = !!cue && time >= cue.start && time < cue.end, visible = yellowPixels >= 3;
    if (visible && should) this.visibleFrames[this.index]++;
    if (visible !== should) {
      const near = [cue?.start, cue?.end, previous?.end].some(value => value !== undefined && Math.abs(time - value) <= 1 / 30 + 1e-7);
      assert.ok(near, `Caption presence at ${time.toFixed(6)}s: ${yellowPixels} yellow pixels`); this.boundaryFrames++;
    }
  }
  finish() {
    assert.ok(Math.abs(this.lastTime + 1 / 30 - this.expected.duration) <= 1 / 30 + 1e-7, 'Video end clock');
    assert.equal(this.frames, Math.round(this.expected.duration * 30), 'Full 30fps video frame count');
    this.visibleFrames.forEach((count, i) => assert.ok(count >= Math.floor((this.expected.captions[i].end - this.expected.captions[i].start) * 30) - 2, `Missing caption frames: ${this.expected.captions[i].id}`));
    return { frames: this.frames, lastTime: this.lastTime, visibleFrames: this.visibleFrames, boundaryFrames: this.boundaryFrames, toleranceSeconds: 1 / 30 };
  }
}
