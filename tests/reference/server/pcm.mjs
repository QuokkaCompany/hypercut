export class SilenceDetector {
  constructor({ sampleRate, channels, thresholdDb, minSilenceMs, duration, bins = 1600 }) {
    this.sampleRate = sampleRate; this.channels = channels;
    this.threshold = Math.fround(10 ** (thresholdDb / 20));
    this.minimum = Math.ceil(minSilenceMs * sampleRate / 1000);
    this.duration = duration; this.peaks = new Float32Array(bins);
    this.samples = 0; this.quietStart = null; this.candidates = [];
  }
  push(samples) {
    if (samples.length % this.channels) throw new Error('PCM 채널 경계가 맞지 않습니다.');
    for (let i = 0; i < samples.length; i += this.channels) {
      let peak = 0;
      for (let c = 0; c < this.channels; c++) peak = Math.max(peak, Math.abs(samples[i + c]));
      const bucket = Math.min(this.peaks.length - 1, Math.floor(this.samples / this.sampleRate / this.duration * this.peaks.length));
      this.peaks[bucket] = Math.max(this.peaks[bucket], peak);
      if (peak <= this.threshold) { if (this.quietStart === null) this.quietStart = this.samples; }
      else this.endQuiet();
      this.samples++;
    }
  }
  endQuiet() {
    if (this.quietStart !== null && this.samples - this.quietStart >= this.minimum) this.candidates.push({ start: this.quietStart / this.sampleRate, end: this.samples / this.sampleRate });
    this.quietStart = null;
  }
  finish() {
    const quietAtEnd = this.quietStart !== null;
    this.endQuiet();
    const last = this.candidates.at(-1);
    // Video duration need not land on an audio sample boundary (e.g. 29.97 fps).
    // Only the final quiet run may cover the remaining fractional sample.
    if (quietAtEnd && last && Math.abs(last.end - this.duration) <= 1 / this.sampleRate + 1e-9) last.end = this.duration;
    return { candidates: this.candidates, peaks: Array.from(this.peaks), samples: this.samples };
  }
}

// Carries incomplete interleaved sample frames across arbitrary stdout chunks.
export async function consumePCM(stream, channels, onFrames) {
  let remainder = Buffer.alloc(0);
  const frameBytes = channels * 4;
  for await (const chunk of stream) {
    const bytes = remainder.length ? Buffer.concat([remainder, chunk]) : chunk;
    const length = bytes.length - bytes.length % frameBytes;
    if (length) {
      const aligned = new Uint8Array(length);
      aligned.set(bytes.subarray(0, length));
      await onFrames(new Float32Array(aligned.buffer), bytes.subarray(0, length));
    }
    remainder = Buffer.from(bytes.subarray(length));
  }
  if (remainder.length) throw new Error('오디오 샘플이 중간에 잘렸습니다.');
}
