import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rm, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import { capture, startProcess } from './process.mjs';
import { consumePCM, SilenceDetector } from './pcm.mjs';
import { createCuts, keptIntervals, intervalDuration, normalizeIntervals, snapRemovals, videoExpressions, validateSettings } from '../shared/timeline.mjs';

const rational = value => { const [n, d = 1] = String(value).split('/').map(Number); return d && Number.isFinite(n / d) ? n / d : 0; };

export async function inspectMedia(filePath, name, signal) {
  const info = JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath], { signal }));
  const video = info.streams.find(x => x.codec_type === 'video' && !x.disposition?.attached_pic);
  if (!video) throw new Error('영상 트랙이 없는 파일입니다. MP4 또는 MOV 영상을 선택해 주세요.');
  if (video.codec_name !== 'h264') throw new Error(`현재는 H.264 영상을 지원합니다. 이 파일의 코덱: ${video.codec_name}`);
  if (['smpte2084', 'arib-std-b67'].includes(video.color_transfer)) throw new Error('HDR 영상은 아직 지원하지 않습니다. SDR H.264로 변환한 영상을 선택해 주세요.');
  const duration = Number(video.duration || info.format.duration);
  if (!(duration > 0) || !Number.isFinite(duration)) throw new Error('영상 길이를 읽을 수 없습니다.');
  const timeBase = rational(video.time_base);
  const origin = video.start_pts !== undefined ? Number(video.start_pts) * timeBase : Number(video.start_time || 0);
  const fingerprint = createHash('sha256');
  for await (const bytes of createReadStream(filePath)) { if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError'); fingerprint.update(bytes); }
  return {
    id: randomUUID(), path: filePath, name: path.basename(name || filePath), duration, fingerprint: fingerprint.digest('hex'),
    width: video.width, height: video.height, fps: rational(video.avg_frame_rate) || 30, size: (await stat(filePath)).size,
    videoIndex: video.index, timeBase, origin,
    audioTracks: info.streams.filter(x => x.codec_type === 'audio').map(x => ({ index: x.index, codec: x.codec_name, channels: x.channels, sampleRate: Number(x.sample_rate), label: x.tags?.title || x.tags?.handler_name || `오디오 ${x.index}`, language: x.tags?.language || '' }))
  };
}

export function publicMedia(media) { const { path: ignoredPath, frames: ignoredFrames, playbacks: ignoredPlaybacks, ...safe } = media; return safe; }

export async function playbackFile(media, trackIndex, directory, { signal } = {}) {
  if (Math.abs(media.origin) < 1e-7 && (!media.audioTracks.length || media.audioTracks[0].index === trackIndex)) return media.path;
  const track = getTrack(media, trackIndex);
  const key = `${media.id}-${track.index}`;
  media.playbacks ??= new Map();
  if (!media.playbacks.has(key)) media.playbacks.set(key, (async () => {
    const destination = path.join(directory, `${key}-playback.mp4`);
    await capture('ffmpeg', ['-v', 'error', '-nostdin', '-copyts', '-itsoffset', String(-media.origin), '-i', media.path,
      '-map', `0:${media.videoIndex}`, '-map', `0:${track.index}`, '-c:v', 'copy', '-af', `aresample=async=1:first_pts=0,apad,atrim=end=${media.duration}`,
      '-c:a', 'aac', '-b:a', '192k', '-t', String(media.duration), '-movflags', '+faststart', '-y', destination], { signal });
    return destination;
  })().catch(error => { media.playbacks.delete(key); throw error; }));
  return media.playbacks.get(key);
}

async function getFrames(media, signal, progress) {
  if (media.frames) return media.frames;
  progress?.({ stage: '프레임 시간표 확인', progress: 0.03 });
  const { child, done } = startProcess('ffprobe', ['-v', 'error', '-select_streams', String(media.videoIndex), '-show_entries', 'frame=best_effort_timestamp', '-of', 'csv=p=0', media.path], { signal });
  const frames = [0];
  for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
    const value = Number(line.split(',')[0]);
    const time = value * media.timeBase - media.origin;
    if (line.trim() && Number.isFinite(time) && time >= 0 && time < media.duration) frames.push(time);
  }
  await done;
  frames.push(media.duration);
  media.frames = [...new Set(frames)].sort((a, b) => a - b);
  return media.frames;
}

function audioArgs(media, track) {
  return ['-v', 'error', '-nostdin', '-copyts', '-i', media.path, '-map', `0:${track.index}`, '-vn',
    '-af', `asetpts=PTS-(${media.origin})/TB,aresample=async=1:first_pts=0,apad,atrim=end=${media.duration}`,
    '-ar', String(track.sampleRate), '-ac', String(track.channels), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'];
}

function getTrack(media, trackIndex) {
  const track = media.audioTracks.find(x => x.index === trackIndex);
  if (!track) throw new Error('분석할 오디오 트랙을 선택해 주세요.');
  if (!(track.channels > 0 && track.channels <= 8 && track.sampleRate > 0)) throw new Error('지원하지 않는 오디오 구성입니다.');
  return track;
}

export async function analyzeMedia(media, settingsInput, trackIndex, { signal, progress } = {}) {
  const settings = validateSettings(settingsInput);
  const track = getTrack(media, trackIndex);
  const frames = await getFrames(media, signal, progress);
  const detector = new SilenceDetector({ ...settings, sampleRate: track.sampleRate, channels: track.channels, duration: media.duration });
  const { child, done } = startProcess('ffmpeg', audioArgs(media, track), { signal });
  let lastUpdate = 0;
  try {
    await consumePCM(child.stdout, track.channels, samples => {
      detector.push(samples);
      if (Date.now() - lastUpdate > 200) { progress?.({ stage: '음량과 무음 구간 분석', progress: 0.15 + 0.8 * Math.min(1, detector.samples / track.sampleRate / media.duration) }); lastUpdate = Date.now(); }
    });
    await done;
  } catch (error) { child.kill(); throw error; }
  const { candidates, peaks, samples } = detector.finish();
  return { settings, trackIndex, candidates, peaks, cuts: createCuts(candidates, settings, media.duration, frames), decodedSamples: samples };
}

async function writeEditedAudio(media, track, kept, destination, signal, progress) {
  const output = createWriteStream(destination, { flags: 'wx' });
  let outputError;
  output.on('error', error => { outputError = error; });
  const { child, done } = startProcess('ffmpeg', audioArgs(media, track), { signal });
  const ranges = kept.map(x => ({ start: Math.round(x.start * track.sampleRate), end: Math.round(x.end * track.sampleRate) }));
  let position = 0, index = 0, lastUpdate = 0, written = 0;
  try {
    await consumePCM(child.stdout, track.channels, async (samples, bytes) => {
      const end = position + samples.length / track.channels;
      while (index < ranges.length && ranges[index].end <= position) index++;
      for (let i = index; i < ranges.length && ranges[i].start < end; i++) {
        const startSample = Math.max(position, ranges[i].start), endSample = Math.min(end, ranges[i].end);
        if (endSample > startSample) {
          if (outputError) throw outputError;
          const chunk = bytes.subarray((startSample - position) * track.channels * 4, (endSample - position) * track.channels * 4);
          if (!output.write(chunk)) await once(output, 'drain');
          written += endSample - startSample;
        }
      }
      position = end;
      if (Date.now() - lastUpdate > 200) { progress?.({ stage: '오디오 컷 편집', progress: 0.05 + 0.25 * Math.min(1, position / track.sampleRate / media.duration) }); lastUpdate = Date.now(); }
    });
    await done;
    output.end(); await once(output, 'close');
    if (outputError) throw outputError;
    return written;
  } catch (error) { child.kill(); output.destroy(); throw error; }
}

export async function exportMedia(media, cuts, trackIndex, directory, { signal, progress, preview = false } = {}) {
  const track = getTrack(media, trackIndex);
  const frames = await getFrames(media, signal, progress);
  const removals = snapRemovals(normalizeIntervals(cuts.filter(x => x.enabled), media.duration), media.duration, frames);
  const kept = keptIntervals(removals.map(x => ({ ...x, enabled: true })), media.duration);
  const expectedDuration = intervalDuration(kept);
  if (!kept.length || expectedDuration < 0.05) throw new Error('모든 구간이 제거되었습니다. 내보내려면 일부 구간을 복원해 주세요.');
  const id = randomUUID();
  const work = path.join(directory, `${id}.work`);
  await mkdir(work, { recursive: true });
  const pcmPath = path.join(work, 'edited.f32');
  const temporaryOutput = path.join(work, 'output.mp4');
  try {
    const audioSamples = await writeEditedAudio(media, track, kept, pcmPath, signal, progress);
    const { select, offset } = videoExpressions(removals);
    const scale = preview ? ',scale=w=960:h=540:force_original_aspect_ratio=decrease:force_divisible_by=2' : ',pad=ceil(iw/2)*2:ceil(ih/2)*2';
    const graph = `[0:${media.videoIndex}]setpts=PTS-(${media.origin})/TB,select='${select}',setpts='PTS-(${offset})/TB'${scale}[v]`;
    const filterPath = path.join(work, 'filter.txt');
    await writeFile(filterPath, graph);
    const args = ['-v', 'error', '-nostdin', '-copyts', '-i', media.path, '-f', 'f32le', '-ar', String(track.sampleRate), '-ac', String(track.channels), '-i', pcmPath,
      '-filter_complex_script', filterPath, '-map', '[v]', '-map', '1:a:0', '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'veryfast', '-crf', preview ? '25' : '18',
      '-pix_fmt', 'yuv420p', '-fps_mode', 'vfr', '-enc_time_base:v', '1:90000', '-video_track_timescale', '90000', '-c:a', 'aac', '-b:a', '192k',
      '-t', expectedDuration.toFixed(9), '-movflags', '+faststart', '-progress', 'pipe:1', '-y', temporaryOutput];
    const { child, done } = startProcess('ffmpeg', args, { signal });
    for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      if (line.startsWith('out_time_us=')) progress?.({ stage: preview ? '정확한 미리보기 생성' : '영상 렌더링', progress: 0.3 + 0.6 * Math.min(1, Number(line.split('=')[1]) / 1e6 / expectedDuration) });
    }
    await done;
    progress?.({ stage: '결과 파일 검증', progress: 0.93 });
    const outputInfo = JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', temporaryOutput], { signal }));
    const outputDuration = Number(outputInfo.format.duration);
    const tolerance = Math.max(1 / media.fps, 1024 / track.sampleRate) + 0.005;
    if (Math.abs(outputDuration - expectedDuration) > tolerance) throw new Error(`출력 길이 검증 실패 (${outputDuration.toFixed(3)}초 / 예상 ${expectedDuration.toFixed(3)}초)`);
    if (outputInfo.streams.filter(x => x.codec_type === 'video').length !== 1 || outputInfo.streams.filter(x => x.codec_type === 'audio').length !== 1) throw new Error('출력 트랙 검증에 실패했습니다.');
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', temporaryOutput, '-f', 'null', '-'], { signal });
    if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError');
    const destination = path.join(directory, `${id}.mp4`);
    await rename(temporaryOutput, destination);
    return { id, path: destination, name: `${path.parse(media.name).name}${preview ? '-preview' : '-hypercut'}.mp4`, duration: outputDuration, expectedDuration, size: (await stat(destination)).size, audioSamples, verified: true };
  } finally { await rm(work, { recursive: true, force: true }); }
}
