export const EFFECT_LIMITS = Object.freeze({ assets: 32, clips: 128, seconds: 300, bytes: 1024 ** 3 });
export const EMPTY_EFFECTS = Object.freeze({ assets: [], clips: [] });
const hash = /^[a-f0-9]{64}$/;
const clipId = /^[a-zA-Z0-9_-]{1,80}$/;
const finite = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;

/** @param {any} value @param {number} mediaDuration */
export function validateEffects(value = EMPTY_EFFECTS, mediaDuration) {
  if (!(mediaDuration > 0) || !Number.isFinite(mediaDuration)) throw new Error('효과음의 영상 길이가 올바르지 않습니다.');
  if (!value || !Array.isArray(value.assets) || !Array.isArray(value.clips) || value.assets.length > EFFECT_LIMITS.assets || value.clips.length > EFFECT_LIMITS.clips) throw new Error('효과음은 음원 32개, 클립 128개까지 사용할 수 있습니다.');
  const assets = new Map();
  for (const a of value.assets) {
    if (!a || !hash.test(a.id) || a.fingerprint !== a.id || assets.has(a.id) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 255 || !finite(a.duration, .01, EFFECT_LIMITS.seconds)) throw new Error('효과음 파일 식별 정보가 손상됐습니다.');
    assets.set(a.id, { id: a.id, fingerprint: a.fingerprint, name: a.name, duration: a.duration });
  }
  const ids = new Set();
  const clips = value.clips.map(c => {
    const a = c && assets.get(c.assetId);
    if (!a || typeof c.id !== 'string' || !clipId.test(c.id) || ids.has(c.id) || !finite(c.start, 0, mediaDuration) || c.start >= mediaDuration || !finite(c.offset, 0, a.duration) || c.offset >= a.duration || !finite(c.duration, .01, EFFECT_LIMITS.seconds) || !finite(c.gainDb, -60, 12) || typeof c.muted !== 'boolean') throw new Error('효과음의 시각·길이·음량 또는 클립 ID가 올바르지 않습니다.');
    ids.add(c.id);
    return { id: c.id, assetId: c.assetId, start: c.start, offset: c.offset, duration: c.duration, gainDb: c.gainDb, muted: c.muted };
  });
  return { assets: [...assets.values()], clips };
}

// Source anchors never move when a cut is restored. Range previews crop the
// *full edited mix*, including tails whose anchors precede the preview range.
export function mapEffects(effects, kept, window) {
  const duration = kept.reduce((n, x) => n + x.end - x.start, 0);
  const assets = new Map(effects.assets.map(a => [a.id, a]));
  const output = [];
  for (const clip of effects.clips) {
    if (clip.muted) continue;
    let cursor = 0, anchor;
    for (const span of kept) {
      if (clip.start >= span.start && clip.start < span.end) { anchor = cursor + clip.start - span.start; break; }
      cursor += span.end - span.start;
    }
    if (anchor === undefined) continue;
    const end = Math.min(duration, anchor + clip.duration, anchor + assets.get(clip.assetId).duration - clip.offset);
    const from = Math.max(anchor, window?.start ?? 0), to = Math.min(end, window?.end ?? duration);
    if (to > from) output.push({ ...clip, start: from - (window?.start ?? 0), offset: clip.offset + from - anchor, duration: to - from });
  }
  return output;
}
