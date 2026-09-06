export const MAX_TRANSCRIPTION_END_OVERFLOW_SECONDS = 30;

export function validateTranscript(value, duration) {
  if (value == null) return null;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isInteger(value.trackIndex) || value.trackIndex < 0 || !Number.isInteger(value.channel) || value.channel < 0 || value.channel > 7 || !['ko', 'en', 'auto'].includes(value.language)) throw new Error('전사 설정이 올바르지 않습니다.');
  if (!Array.isArray(value.cues) || value.cues.length > 10000) throw new Error('자막 구간 수가 올바르지 않습니다.');
  const ids = new Set(); let length = 0;
  const cues = value.cues.map(cue => {
    if (typeof cue.id !== 'string' || cue.id.length > 100 || ids.has(cue.id)) throw new Error('자막 ID가 중복되거나 손상됐습니다.');
    ids.add(cue.id);
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end <= cue.start || cue.end > duration) throw new Error('자막 시각이 영상 범위를 벗어났습니다.');
    if (typeof cue.text !== 'string' || !cue.text.trim() || cue.text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(cue.text)) throw new Error('자막 문구를 확인해 주세요.');
    const text = cue.text.replace(/\r\n?/g, '\n').replace(/\n\s*\n/g, '\n').trim(); length += text.length;
    const warning = cue.timingWarning;
    if (warning !== undefined && (!warning || typeof warning !== 'object' || Array.isArray(warning) || Object.keys(warning).length !== 2 || warning.kind !== 'source-end' || !Number.isFinite(warning.originalEnd) || warning.originalEnd <= duration || warning.originalEnd > duration + MAX_TRANSCRIPTION_END_OVERFLOW_SECONDS)) throw new Error('자막 끝 경계 검토 정보가 올바르지 않습니다.');
    if (cue.reviewedFor !== undefined && (typeof cue.reviewedFor !== 'string' || cue.reviewedFor.length > 65536)) throw new Error('자막 검토 정보가 올바르지 않습니다.');
    return { id: cue.id, start: cue.start, end: cue.end, text, ...(warning ? { timingWarning: { kind: 'source-end', originalEnd: warning.originalEnd } } : {}), ...(cue.reviewedFor ? { reviewedFor: cue.reviewedFor } : {}) };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  if (length > 2 * 1024 ** 2) throw new Error('자막 문구가 너무 많습니다.');
  for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end - 1e-6) throw new Error('자막 구간이 겹칩니다. 시작과 끝 시각을 조절해 주세요.');
  const model = typeof value.model === 'string' && value.model.length <= 200 ? value.model : 'manual';
  return { trackIndex: value.trackIndex, channel: value.channel, language: value.language, model, cues };
}

// Caption content never determines cuts. Review is tied to exact text, source
// timing and retained pieces so a new cut cannot reuse a stale review.
export function mapCaptions(transcript, kept) {
  if (!transcript) return [];
  const offsets = []; let total = 0;
  for (const range of kept) { offsets.push(total); total += range.end - range.start; }
  return transcript.cues.map(cue => {
    const parts = []; let start, end, retained = 0;
    let low = 0, high = kept.length;
    while (low < high) { const mid = (low + high) >>> 1; if (kept[mid].end <= cue.start) low = mid + 1; else high = mid; }
    for (let i = low; i < kept.length && kept[i].start < cue.end; i++) {
      const from = Math.max(cue.start, kept[i].start), to = Math.min(cue.end, kept[i].end);
      if (to > from) { parts.push([from, to]); retained += to - from; start ??= offsets[i] + from - kept[i].start; end = offsets[i] + to - kept[i].start; }
    }
    const removed = parts.length === 0;
    const changed = !removed && Math.abs(retained - (cue.end - cue.start)) > 1e-6;
    const reviewKey = JSON.stringify([cue.start, cue.end, cue.text, parts, ...(cue.timingWarning ? [cue.timingWarning] : [])]);
    return { ...cue, outputStart: start, outputEnd: end, removed, needsReview: !removed && (changed || !!cue.timingWarning) && cue.reviewedFor !== reviewKey, reviewKey };
  });
}

function stamp(seconds) {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
export function toSRT(transcript, kept) {
  const mapped = mapCaptions(transcript, kept);
  if (mapped.some(cue => cue.needsReview)) throw new Error('출력할 자막의 문구와 경계를 먼저 검토해 주세요.');
  const visible = mapped.filter(cue => !cue.removed);
  if (!visible.length) throw new Error('내보낼 자막이 없습니다.');
  return visible.map((cue, i) => {
    if (Math.round(cue.outputEnd * 1000) <= Math.round(cue.outputStart * 1000)) throw new Error('1ms보다 짧은 자막 구간을 조절해 주세요.');
    const text = cue.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `${i + 1}\n${stamp(cue.outputStart)} --> ${stamp(cue.outputEnd)}\n${text}\n`;
  }).join('\n');
}

/** Source-clock listening preview, including visibly unreviewed cues. Never used for exports. */
export function toSourceVTT(transcript, duration) {
  const source = validateTranscript(transcript, duration);
  return 'WEBVTT\n\n' + (source?.cues || []).map(cue => `${stamp(cue.start).replace(',', '.')} --> ${stamp(cue.end).replace(',', '.')}\n${cue.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}\n`).join('\n');
}
