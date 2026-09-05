import { normalizeIntervals } from './timeline.mjs';

// Half-open interval difference. Protection only removes deletion candidates.
export function protectSpeech(candidates, speech, duration) {
  const source = normalizeIntervals(candidates, duration), protectedRanges = normalizeIntervals(speech, duration), result = [];
  let index = 0;
  for (const candidate of source) {
    let cursor = candidate.start;
    while (index < protectedRanges.length && protectedRanges[index].end <= cursor) index++;
    for (let j = index; j < protectedRanges.length && protectedRanges[j].start < candidate.end; j++) {
      const voice = protectedRanges[j];
      if (voice.start > cursor) result.push({ start: cursor, end: Math.min(voice.start, candidate.end) });
      cursor = Math.max(cursor, voice.end);
      if (cursor >= candidate.end) break;
    }
    if (cursor < candidate.end) result.push({ start: cursor, end: candidate.end });
  }
  return result;
}

export class SpeechWindows {
  constructor(threshold, channels) { this.threshold = threshold; this.channels = channels; this.ranges = []; }
  push(probabilities, start, end) {
    if (probabilities.length !== this.channels || Array.from(probabilities).some(x => !Number.isFinite(x) || x < 0 || x > 1)) throw new Error('음성 감지 모델이 유효한 점수를 반환하지 않았습니다.');
    if (!Array.from(probabilities).some(x => x >= this.threshold)) return;
    const previous = this.ranges.at(-1);
    if (previous && start - previous.end <= 0.16 + 1e-9) previous.end = end;
    else this.ranges.push({ start, end });
  }
  finish(duration) { return normalizeIntervals(this.ranges.map(x => ({ start: x.start - 0.032, end: x.end + 0.032 })), duration); }
}
