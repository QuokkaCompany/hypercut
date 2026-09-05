import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCaptionStyle } from '../shared/caption-style.mjs';
import { mapCaptions, validateTranscript } from '../shared/captions.mjs';

export function captionCues(input, media, trackIndex, fullKept, renderKept = fullKept) {
  const transcript = validateTranscript(input, media.duration);
  if (!transcript?.cues.length) throw new Error('영상에 넣을 자막이 없습니다. 전사하거나 자막 포함을 꺼 주세요.');
  const track = media.audioTracks.find(track => track.index === trackIndex);
  if (transcript.trackIndex !== trackIndex || !track || transcript.channel >= track.channels) throw new Error('현재 오디오 트랙과 자막의 전사 트랙이 다릅니다.');
  const reviewed = new Map(mapCaptions(transcript, fullKept).map(cue => [cue.id, cue]));
  return mapCaptions(transcript, renderKept).filter(cue => !cue.removed).map(cue => {
    if (reviewed.get(cue.id).needsReview) throw new Error('컷과 겹치는 자막 문구를 먼저 검토해 주세요.');
    return { start: cue.outputStart, end: cue.outputEnd, text: cue.text };
  });
}
export function renderCaptionImages(input, { signal, progress, fontDirectory = process.env.HYPERCUT_CAPTION_FONT_DIR } = {}) {
  signal?.throwIfAborted();
  const style = validateCaptionStyle(input.style);
  return new Promise((resolve, reject) => {
    const child = fork(fileURLToPath(new URL('./caption-render-worker.mjs', import.meta.url)), [], { execArgv: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DISABLE_SYSTEM_FONTS_LOAD: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    let result, error, stderr = '', timer;
    child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4000); });
    const abort = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), 1000); timer.unref(); };
    signal?.addEventListener('abort', abort, { once: true });
    child.on('message', message => { if (message?.type === 'result') result = message.result; if (message?.type === 'error') error = message.error; if (message?.type === 'progress') progress?.(message.value); });
    child.once('error', cause => { error = cause.message; });
    child.once('close', code => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new DOMException('작업이 취소되었습니다.', 'AbortError'));
      else if (code !== 0 || !result) reject(new Error(error || `자막 렌더러를 실행할 수 없습니다. 앱을 다시 설치해 주세요. ${stderr.slice(-500)}`));
      else resolve(result);
    });
    child.send({ ...input, style, fontDirectory }, sendError => { if (sendError) { error = sendError.message; child.kill(); } });
    if (signal?.aborted) abort();
  });
}
