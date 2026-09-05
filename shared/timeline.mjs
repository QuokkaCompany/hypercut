export const DEFAULT_SETTINGS = Object.freeze({ thresholdDb: -40, minSilenceMs: 500, preRollMs: 100, postRollMs: 150 });
const EPS = 1e-8;

/** @returns {{ thresholdDb: number, minSilenceMs: number, preRollMs: number, postRollMs: number }} */
export function validateSettings(input) {
  const ranges = { thresholdDb: [-96, 0], minSilenceMs: [50, 5000], preRollMs: [0, 1000], postRollMs: [0, 1000] };
  const result = {};
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const value = input?.[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error(`올바른 설정이 아닙니다: ${key} (${min}~${max})`);
    result[key] = value;
  }
  return result;
}

export function normalizeIntervals(intervals, duration) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('영상 길이가 올바르지 않습니다.');
  const sorted = intervals.map(({ start, end }) => {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('잘못된 편집 구간입니다.');
    return { start: Math.max(0, start), end: Math.min(duration, end) };
  }).filter(x => x.end > x.start).sort((a, b) => a.start - b.start);
  const result = [];
  for (const interval of sorted) {
    const previous = result.at(-1);
    if (previous && interval.start <= previous.end + EPS) previous.end = Math.max(previous.end, interval.end);
    else result.push({ ...interval });
  }
  return result;
}

export function lowerBound(values, value) {
  let low = 0, high = values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid] < value - EPS) low = mid + 1; else high = mid; }
  return low;
}

export function snapRemovals(intervals, duration, frames) {
  if (!frames?.length) throw new Error('영상 프레임 정보를 먼저 확인해야 합니다.');
  return normalizeIntervals(intervals, duration).map(({ start, end }) => {
    const begin = frames[lowerBound(frames, start)] ?? duration;
    const endIndex = lowerBound(frames, end);
    const finish = Math.abs((frames[endIndex] ?? Infinity) - end) < EPS ? frames[endIndex] : frames[Math.max(0, endIndex - 1)];
    return { start: begin, end: finish };
  }).filter(x => x.end - x.start >= 0.1 - EPS);
}

export function createCuts(candidates, settings, duration, frames) {
  const s = validateSettings(settings);
  const padded = normalizeIntervals(candidates, duration).filter(x => x.end - x.start >= s.minSilenceMs / 1000 - EPS).map(x => ({
    start: x.start <= EPS ? 0 : x.start + s.postRollMs / 1000,
    end: x.end >= duration - EPS ? duration : x.end - s.preRollMs / 1000
  })).filter(x => x.end - x.start >= 0.1 - EPS);
  return snapRemovals(padded, duration, frames).map((x, index) => ({ ...x, id: `silence-${index}-${x.start.toFixed(6)}`, enabled: true, reason: 'silence' }));
}

export function keptIntervals(cuts, duration) {
  const removed = normalizeIntervals(cuts.filter(x => x.enabled), duration);
  const kept = [];
  let cursor = 0;
  for (const x of removed) { if (x.start > cursor + EPS) kept.push({ start: cursor, end: x.start }); cursor = x.end; }
  if (cursor < duration - EPS) kept.push({ start: cursor, end: duration });
  return kept;
}

// Preview windows preserve the same cut boundaries as a full export. Only the
// outside window is excluded, even when that exclusion is shorter than 100ms.
export function renderPlan(cuts, duration, frames, range) {
  let removals = snapRemovals(normalizeIntervals(cuts.filter(x => x.enabled), duration), duration, frames);
  let sourceRange;
  if (range !== undefined) {
    if (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.start < 0 || range.end > duration || range.start >= range.end) throw new Error('미리보기 범위가 올바르지 않습니다.');
    const index = lowerBound(frames, range.start);
    const start = frames[index] > range.start + EPS ? frames[Math.max(0, index - 1)] : frames[index];
    const end = frames[lowerBound(frames, range.end)] ?? duration;
    sourceRange = { start, end };
    removals = normalizeIntervals([...removals, ...(start > 0 ? [{ start: 0, end: start }] : []), ...(end < duration ? [{ start: end, end: duration }] : [])], duration);
  }
  return { removals, kept: keptIntervals(removals.map(x => ({ ...x, enabled: true })), duration), sourceRange };
}

export function restoreRange(cuts, start, end, duration, frames) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration || start >= end) throw new Error('복원 범위는 영상 안에서 시작보다 끝이 늦어야 합니다.');
  if (!frames?.length) throw new Error('영상 프레임 정보가 필요합니다.');
  const index = lowerBound(frames, start);
  const begin = frames[index] > start + EPS ? frames[Math.max(0, index - 1)] : frames[index];
  const finish = frames[lowerBound(frames, end)] ?? duration;
  let sequence = 0;
  const ids = new Set(cuts.map(cut => cut.id));
  const nextId = () => { let id; do { id = `restore-${sequence++}`; } while (ids.has(id)); ids.add(id); return id; };
  const result = cuts.flatMap(cut => {
    if (!cut.enabled || cut.end <= begin || cut.start >= finish) return [{ ...cut }];
    let left = Math.max(cut.start, begin), right = Math.min(cut.end, finish);
    // Tiny leftovers are also restored; export must not silently drop them later.
    if (left - cut.start < 0.1 - EPS) left = cut.start;
    if (cut.end - right < 0.1 - EPS) right = cut.end;
    const parts = [];
    if (left > cut.start) parts.push({ ...cut, id: nextId(), end: left });
    parts.push({ ...cut, id: nextId(), start: left, end: right, enabled: false, reason: 'manual' });
    if (right < cut.end) parts.push({ ...cut, id: nextId(), start: right });
    return parts;
  });
  if (result.length > 50000) throw new Error('편집 구간 수가 제한을 넘습니다.');
  return result;
}

export function intervalDuration(intervals) { return intervals.reduce((sum, x) => sum + x.end - x.start, 0); }

export function sourceToEdited(time, kept) {
  let output = 0;
  for (const x of kept) { if (time <= x.start) return output; if (time < x.end) return output + time - x.start; output += x.end - x.start; }
  return output;
}

export function editedToSource(time, kept) {
  let offset = 0;
  for (const x of kept) { const length = x.end - x.start; if (time < offset + length - EPS) return x.start + Math.max(0, time - offset); offset += length; }
  return kept.at(-1)?.end ?? 0;
}

// O(log(number of cuts)) expression evaluation for every decoded video frame.
function piecewise(points, values, variable, lo = 0, hi = values.length - 1) {
  if (lo === hi) return String(values[lo]);
  const mid = (lo + hi) >>> 1;
  return `if(lt(${variable},${points[mid].toFixed(9)}),${piecewise(points, values, variable, lo, mid)},${piecewise(points, values, variable, mid + 1, hi)})`;
}

export function videoExpressions(removals) {
  const points = [], selectValues = [1], offsets = [0];
  let total = 0;
  for (const x of removals) { points.push(x.start, x.end); selectValues.push(0, 1); offsets.push(total, total + x.end - x.start); total += x.end - x.start; }
  return { select: piecewise(points, selectValues, 't'), offset: piecewise(points, offsets.map(x => Number(x.toFixed(9))), 'T') };
}

export function makeProject(media, settings, trackIndex, cuts) {
  return { format: 'hypercut-project', version: 1, media: { name: media.name, fingerprint: media.fingerprint, duration: media.duration }, settings: validateSettings(settings), trackIndex, cuts, savedAt: new Date().toISOString() };
}

export function validateProject(value) {
  if (value?.format !== 'hypercut-project' || value.version !== 1) throw new Error('지원하지 않는 HyperCut 프로젝트입니다.');
  if (!/^[a-f0-9]{64}$/.test(value.media?.fingerprint ?? '') || typeof value.media.name !== 'string') throw new Error('원본 파일 식별 정보가 손상됐습니다.');
  if (!Number.isInteger(value.trackIndex) || value.trackIndex < 0) throw new Error('오디오 트랙 정보가 올바르지 않습니다.');
  const settings = validateSettings(value.settings);
  if (!Array.isArray(value.cuts) || value.cuts.length > 50000) throw new Error('편집 구간 정보를 읽을 수 없습니다.');
  const ids = new Set();
  const cuts = value.cuts.map(x => {
    if (typeof x.id !== 'string' || ids.has(x.id) || typeof x.enabled !== 'boolean') throw new Error('중복되거나 손상된 편집 구간입니다.');
    ids.add(x.id);
    if (!Number.isFinite(x.start) || !Number.isFinite(x.end) || !(x.start >= 0 && x.end <= value.media.duration && x.end > x.start)) throw new Error('편집 구간이 영상 범위를 벗어났습니다.');
    return { id: x.id, start: x.start, end: x.end, enabled: x.enabled, reason: x.reason === 'manual' ? 'manual' : 'silence' };
  });
  normalizeIntervals(cuts, value.media.duration);
  return { ...value, settings, cuts };
}
