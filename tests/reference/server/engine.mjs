import { analyzeMedia, exportMedia, exportCaptions, restoreMediaRange } from './media.mjs';
import { validateSettings } from '../../../shared/timeline.mjs';
import { validateSpeechProtection } from '../../../shared/speech-settings.mjs';
import { transcribeMedia, validateTranscriptionSettings } from './transcription.mjs';
import { validateTranscript } from '../../../shared/captions.mjs';
import { validateCaptionStyle } from '../../../shared/caption-style.mjs';
import { validateEffects } from '../../../shared/effects.mjs';

export const isRequestId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
export function validateMediaJob(input, item) {
  const { type, settings, trackIndex, cuts, requestId, range, speechProtection, transcription, transcript, captionStyle, effects, textMode } = input;
    if (requestId !== undefined && !isRequestId(requestId)) throw new Error('작업 ID가 올바르지 않습니다.');
    if (!['analyze', 'export', 'preview', 'restore', 'transcribe', 'captions', 'transcript'].includes(type)) throw new Error('지원하지 않는 작업입니다.');
    if (!Number.isInteger(trackIndex) || !item.audioTracks.some(x => x.index === trackIndex)) throw new Error('오디오 트랙을 선택해 주세요.');
    if (type === 'analyze') { validateSettings(settings); validateSpeechProtection(speechProtection); }
    else if (type === 'transcribe') validateTranscriptionSettings(transcription, item, trackIndex);
    else {
      if (!Array.isArray(cuts) || cuts.length > 50000) throw new Error('편집 구간이 올바르지 않습니다.');
      for (const x of cuts) if (typeof x.enabled !== 'boolean' || !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.start < 0 || x.end > item.duration || x.end <= x.start) throw new Error('편집 구간이 영상 범위를 벗어났습니다.');
    }
    if (type === 'transcript' && !['source', 'edited'].includes(textMode)) throw new Error('대본 출력 범위를 선택해 주세요.');
    if (['captions', 'transcript'].includes(type)) {
      const data = validateTranscript(transcript, item.duration);
      if (!data || data.trackIndex !== trackIndex) throw new Error('현재 오디오 트랙과 자막의 전사 트랙이 다릅니다.');
    }
    if (['preview', 'export'].includes(type)) {
      validateEffects(effects, item.duration);
      const style = validateCaptionStyle(captionStyle);
      if (style.enabled) { const data = validateTranscript(transcript, item.duration); if (!data || data.trackIndex !== trackIndex) throw new Error('현재 오디오 트랙의 자막을 확인해 주세요.'); }
    }
    if (type === 'restore' && (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.start < 0 || range.end > item.duration || range.start >= range.end)) throw new Error('복원 범위가 올바르지 않습니다.');
    if (range !== undefined && !['restore', 'preview', 'export'].includes(type)) throw new Error('이 작업은 범위 지정을 지원하지 않습니다.');
    if (['preview', 'export'].includes(type) && range !== undefined && (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.start < 0 || range.end > item.duration || range.start >= range.end)) throw new Error('영상 범위가 올바르지 않습니다.');
}

export async function executeMediaJob(input, item, directory, context = {}) {
  const { type, settings, trackIndex, cuts, range, speechProtection, transcription, transcript, captionStyle, effects, textMode } = input;
  const options = { ...context, preview: type === 'preview', range: ['preview', 'export'].includes(type) ? range : undefined, textMode: type === 'transcript' ? textMode : undefined, speechProtection, transcript, captionStyle, effects };
  return type === 'transcribe' ? await transcribeMedia(item, trackIndex, transcription, directory, options) : ['captions', 'transcript'].includes(type) ? await exportCaptions(item, cuts, trackIndex, transcript, directory, options) : type === 'analyze' ? await analyzeMedia(item, settings, trackIndex, options) : type === 'restore' ? await restoreMediaRange(item, cuts, range, options) : await exportMedia(item, cuts, trackIndex, directory, options);
}
