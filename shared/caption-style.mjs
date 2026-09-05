export const DEFAULT_CAPTION_STYLE = Object.freeze({ enabled: false, preset: 'clean', sizePercent: 4.5, position: 'bottom', marginPercent: 8 });
export function validateCaptionStyle(value = DEFAULT_CAPTION_STYLE) {
  if (!value || typeof value.enabled !== 'boolean' || !['clean', 'box', 'emphasis'].includes(value.preset) || !['top', 'bottom'].includes(value.position) || !Number.isFinite(value.sizePercent) || value.sizePercent < 2 || value.sizePercent > 8 || !Number.isFinite(value.marginPercent) || value.marginPercent < 5 || value.marginPercent > 20) throw new Error('자막 스타일 설정이 올바르지 않습니다.');
  return { enabled: value.enabled, preset: value.preset, sizePercent: value.sizePercent, position: value.position, marginPercent: value.marginPercent };
}
// Both timestamps and duration differences are integers in microseconds, so
// thousands of PNG changes cannot accumulate independent rounding errors.
export function captionImageEvents(cues, duration) {
  const end = Math.round(duration * 1e6), events = [{ at: 0, index: -1 }];
  function put(at, index) { const last = events.at(-1); if (last.at === at) last.index = index; else if (last.index !== index) events.push({ at, index }); }
  let previous = 0;
  cues.forEach((cue, index) => {
    const start = Math.round(cue.start * 1e6), finish = Math.round(cue.end * 1e6);
    if (!(start >= previous && finish > start && finish <= end)) throw new Error('합성할 자막 시각이 올바르지 않습니다.');
    put(start, index); put(finish, -1); previous = finish;
  });
  put(end, -1);
  if (events.at(-1).at !== end) events.push({ at: end, index: -1 });
  return events.map((event, i) => ({ ...event, duration: i < events.length - 1 ? (events[i + 1].at - event.at) / 1e6 : 0 }));
}
