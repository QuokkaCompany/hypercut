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
  const unavailable = (reason, error) => {
    signal?.throwIfAborted();
    return { ready: false, reason, model: TRANSCRIPTION_MODEL.name, local: true, error };
  };
  let phase = 'engine', timeout;
  try {
    signal?.throwIfAborted();
    const cli = path.join(runtime, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
    if (!(await stat(cli)).isFile()) return unavailable('engine-invalid', '전사 엔진 경로가 실행 파일이 아닙니다. 호환되는 앱을 다시 설치해 주세요.');
    await access(cli, constants.X_OK);
    phase = 'model';
    const model = path.join(runtime, TRANSCRIPTION_MODEL.file), info = await stat(model);
    if (!info.isFile()) return unavailable('model-invalid', '음성 인식 모델 경로가 파일이 아닙니다. 모델을 다시 준비해 주세요.');
    if (info.size !== TRANSCRIPTION_MODEL.size) return unavailable('model-incomplete', '음성 인식 모델의 크기가 올바르지 않습니다. 준비가 중단됐거나 파일이 손상됐을 수 있으니 모델을 다시 준비해 주세요.');
    await access(model, constants.R_OK);
    signal?.throwIfAborted(); phase = 'version'; timeout = AbortSignal.timeout(10000);
    const version = (await capture(cli, ['--version'], { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })).trim();
    if (!/^(?:whisper\.cpp version: )?1\.9\.3(?:-dev)?$/.test(version)) return unavailable('engine-version', '지원하지 않는 전사 엔진 버전입니다. 호환되는 앱 또는 엔진으로 다시 준비해 주세요.');
    signal?.throwIfAborted();
    return { ready: true, model: TRANSCRIPTION_MODEL.name, engine: version, local: true, integrity: 'checked-at-transcription' };
  } catch (error) {
    signal?.throwIfAborted();
    if (phase === 'version') return timeout?.aborted
      ? unavailable('engine-timeout', '전사 엔진 확인 시간이 초과됐습니다. 잠시 후 다시 확인해 주세요.')
      : unavailable('engine-failed', '이 컴퓨터에서 전사 엔진을 실행하지 못했습니다. 호환되는 앱인지 확인하거나 앱을 다시 설치해 주세요.');
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return phase === 'engine'
      ? unavailable('engine-missing', '로컬 전사 엔진을 찾을 수 없습니다. 전사 기능이 포함된 앱을 다시 설치하거나 로컬 엔진 준비를 완료한 뒤 다시 확인해 주세요.')
      : unavailable('model-missing', '음성 인식 모델을 찾을 수 없습니다. 모델 준비를 완료한 뒤 다시 확인해 주세요.');
    if (error.code === 'EACCES' || error.code === 'EPERM') return phase === 'engine'
      ? unavailable('engine-permission', '전사 엔진을 실행할 권한이 없습니다. 파일 실행 권한을 확인하거나 앱을 다시 설치해 주세요.')
      : unavailable('model-permission', '음성 인식 모델을 읽을 권한이 없습니다. 파일 접근 권한을 확인한 뒤 다시 시도해 주세요.');
    return phase === 'engine'
      ? unavailable('engine-unreadable', '전사 엔진을 확인하지 못했습니다. 파일과 접근 권한을 확인해 주세요.')
      : unavailable('model-unreadable', '음성 인식 모델을 확인하지 못했습니다. 파일과 접근 권한을 확인해 주세요.');
  }
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
