import { access, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { capture } from './process.mjs';
import { transcriptionAudio } from './media.mjs';
import { MAX_TRANSCRIPTION_END_OVERFLOW_SECONDS, validateTranscript } from '../shared/captions.mjs';

export const TRANSCRIPTION_MODEL = Object.freeze({ name: 'Whisper small (multilingual)', file: 'ggml-small.bin', size: 487601967, sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b', engine: 'whisper.cpp 1.9.3', revision: '371b5a7561823ab2bb32142d2751e35e7534727b' });
export function transcriptionRuntime() {
  return process.env.HYPERCUT_TRANSCRIPTION_DIR || (process.resourcesPath ? path.join(process.resourcesPath, 'transcription') : fileURLToPath(new URL('../.hypercut/transcription', import.meta.url)));
}
export function validateTranscriptionSettings(value, media, trackIndex) {
  const track = media.audioTracks.find(track => track.index === trackIndex);
  if (!track || !Number.isInteger(value?.channel) || value.channel < 0 || value.channel >= track.channels || value.channel > 7 || !['ko', 'en', 'auto'].includes(value.language)) throw new Error('전사할 언어와 오디오 채널을 선택해 주세요.');
  return { channel: value.channel, language: value.language };
}
export async function transcriptionStatus(runtime = transcriptionRuntime(), { signal } = {}) {
  try {
    const cli = path.join(runtime, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    await access(cli, constants.X_OK);
    if ((await stat(path.join(runtime, TRANSCRIPTION_MODEL.file))).size !== TRANSCRIPTION_MODEL.size) throw new Error('모델 파일의 크기가 올바르지 않습니다.');
    const version = (await capture(cli, ['--version'], { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) })).trim();
    if (!version.includes('1.9.3')) throw new Error('지원하는 전사 엔진 버전이 아닙니다.');
    return { ready: true, model: TRANSCRIPTION_MODEL.name, engine: version, local: true, integrity: 'checked-at-transcription' };
  } catch { signal?.throwIfAborted(); return { ready: false, model: TRANSCRIPTION_MODEL.name, local: true, error: '로컬 전사 엔진 또는 모델이 준비되지 않았습니다. 개발 환경에서 npm run setup:transcription을 실행하거나 전사 모델을 포함한 앱을 사용해 주세요.' }; }
}
export function parseTranscription(value, media, trackIndex, settings) {
  if (!Array.isArray(value?.transcription) || value.transcription.length > 10000) throw new Error('전사 엔진의 결과 형식이 올바르지 않습니다.');
  const cues = value.transcription.flatMap(segment => {
    if (typeof segment.text !== 'string' || !Number.isFinite(segment.offsets?.from) || !Number.isFinite(segment.offsets?.to) || segment.offsets.from < 0 || segment.offsets.to < segment.offsets.from) throw new Error('전사 엔진의 문구·시각을 읽을 수 없습니다.');
    const text = segment.text.trim();
    if (!text) return [];
    const start = segment.offsets.from / 1000, originalEnd = segment.offsets.to / 1000, crossesEnd = originalEnd > media.duration;
    if (start >= media.duration || (crossesEnd && (originalEnd - start > MAX_TRANSCRIPTION_END_OVERFLOW_SECONDS || start < media.duration - MAX_TRANSCRIPTION_END_OVERFLOW_SECONDS || originalEnd > media.duration + MAX_TRANSCRIPTION_END_OVERFLOW_SECONDS))) throw new Error('전사 시각이 원본 길이와 일치하지 않습니다.');
    return [{ id: randomUUID(), start, end: Math.min(media.duration, originalEnd), text, ...(crossesEnd ? { timingWarning: { kind: 'source-end', originalEnd } } : {}) }];
  });
  return validateTranscript({ trackIndex, ...settings, model: `${TRANSCRIPTION_MODEL.engine} / ${TRANSCRIPTION_MODEL.name} / ${TRANSCRIPTION_MODEL.sha256}`, cues }, media.duration);
}
export async function transcribeMedia(media, trackIndex, input, directory, { signal, progress, runtime = transcriptionRuntime() } = {}) {
  const settings = validateTranscriptionSettings(input, media, trackIndex);
  signal?.throwIfAborted();
  const status = await transcriptionStatus(runtime, { signal }); signal?.throwIfAborted();
  if (!status.ready) throw new Error(status.error);
  progress?.({ stage: '로컬 전사 모델 확인', progress: 0.02 });
  const model = path.join(runtime, TRANSCRIPTION_MODEL.file), hash = createHash('sha256');
  for await (const chunk of createReadStream(model, { signal })) hash.update(chunk);
  if (hash.digest('hex') !== TRANSCRIPTION_MODEL.sha256) throw new Error('전사 모델이 손상됐습니다. 모델을 다시 준비해 주세요.');
  const work = path.join(directory, `${randomUUID()}.transcription`); await mkdir(work, { recursive: true });
  try {
    const wav = path.join(work, 'source.wav'), output = path.join(work, 'result');
    progress?.({ stage: '전사할 음성 준비', progress: 0.05 });
    await transcriptionAudio(media, trackIndex, settings.channel, wav, { signal });
    progress?.({ stage: '로컬에서 음성을 글로 변환', progress: 0.15 });
    await capture(path.join(runtime, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'), ['-m', model, '-f', wav, '-l', settings.language, '-oj', '-of', output, '-pp', '-ng', '-t', '4', '-ml', '60', '-sow', '-sns'], {
      signal, onStderr: text => { const match = /progress\s*=\s*(\d+)%/.exec(text); if (match) progress?.({ stage: '로컬에서 음성을 글로 변환', progress: 0.15 + 0.8 * Math.min(1, Number(match[1]) / 100) }); },
    });
    signal?.throwIfAborted();
    if ((await stat(`${output}.json`)).size > 10 * 1024 ** 2) throw new Error('전사 결과가 너무 큽니다.');
    return parseTranscription(JSON.parse(await readFile(`${output}.json`, 'utf8')), media, trackIndex, settings);
  } finally { await rm(work, { recursive: true, force: true }); }
}
