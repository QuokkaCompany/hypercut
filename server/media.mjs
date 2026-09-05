import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, stat, rm, rename, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import readline from 'node:readline';
import { capture, startProcess } from './process.mjs';
import { consumePCM, SilenceDetector } from './pcm.mjs';
import { createCuts, intervalDuration, renderPlan, videoExpressions, validateSettings, restoreRange } from '../shared/timeline.mjs';
import { validateSpeechProtection } from '../shared/speech-settings.mjs';
import { protectSpeech } from '../shared/speech.mjs';
import { createSpeechDetector, VAD_MODEL } from './vad.mjs';
import { validateTranscript, toSRT } from '../shared/captions.mjs';
import { validateCaptionStyle } from '../shared/caption-style.mjs';
import { captionCues, renderCaptionImages } from './caption-rendering.mjs';
import { validateEffects, mapEffects } from '../shared/effects.mjs';
import { mixEffects, inspectMixedOutput } from './effects.mjs';

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
  const rotation = Number(video.side_data_list?.find(item => item.rotation !== undefined)?.rotation || video.tags?.rotate || 0);
  const quarterTurn = Math.abs(Math.abs(rotation) % 180 - 90) < .001;
  const sar = rational(String(video.sample_aspect_ratio || '1/1').replace(':', '/')) || 1;
  const displayWidth = Math.round(quarterTurn ? video.height : video.width * sar), displayHeight = Math.round(quarterTurn ? video.width * sar : video.height);
  const fingerprint = createHash('sha256');
  for await (const bytes of createReadStream(filePath)) { if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError'); fingerprint.update(bytes); }
  return {
    id: randomUUID(), path: filePath, name: path.basename(name || filePath), duration, fingerprint: fingerprint.digest('hex'),
    width: displayWidth, height: displayHeight, fps: rational(video.avg_frame_rate) || 30, size: (await stat(filePath)).size,
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

export async function restoreMediaRange(media, cuts, range, { signal, progress } = {}) {
  const frames = await getFrames(media, signal, progress);
  signal?.throwIfAborted();
  return { cuts: restoreRange(cuts, range.start, range.end, media.duration, frames) };
}

// Timestamp seeking is only a demux hint. Our trim/aresample filters retain the
// source clock, avoiding input accurate-seek rebasing on nonzero-start files.
function seekArgs(media, start) { return start > 0 ? ['-noaccurate_seek', '-seek_timestamp', '1', '-ss', (media.origin + start).toFixed(9)] : []; }

function audioArgs(media, track, start = 0, end = media.duration) {
  return ['-v', 'error', '-nostdin', '-copyts', ...seekArgs(media, start), '-i', media.path, '-map', `0:${track.index}`, '-vn',
    '-af', `asetpts=PTS-(${media.origin})/TB,aresample=async=1:first_pts=${Math.round(start * track.sampleRate)},apad,atrim=end=${end}`,
    '-ar', String(track.sampleRate), '-ac', String(track.channels), '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'];
}

function getTrack(media, trackIndex) {
  const track = media.audioTracks.find(x => x.index === trackIndex);
  if (!track) throw new Error('분석할 오디오 트랙을 선택해 주세요.');
  if (!(track.channels > 0 && track.channels <= 8 && track.sampleRate > 0)) throw new Error('지원하지 않는 오디오 구성입니다.');
  return track;
}

export async function transcriptionAudio(media, trackIndex, channel, destination, { signal } = {}) {
  const track = getTrack(media, trackIndex);
  if (!Number.isInteger(channel) || channel < 0 || channel >= track.channels) throw new Error('전사할 채널을 선택해 주세요.');
  const args = audioArgs(media, { ...track, sampleRate: 16000 });
  args[args.indexOf('-af') + 1] += `,pan=mono|c0=c${channel}`;
  args[args.indexOf('-ac') + 1] = '1';
  args[args.indexOf('-c:a') + 1] = 'pcm_s16le';
  args[args.indexOf('-f') + 1] = 'wav';
  args[args.length - 1] = destination;
  await capture('ffmpeg', args, { signal });
}

export async function analyzeMedia(media, settingsInput, trackIndex, { signal, progress, speechProtection: speechInput } = {}) {
  const settings = validateSettings(settingsInput);
  const speechProtection = validateSpeechProtection(speechInput);
  const track = getTrack(media, trackIndex);
  const frames = await getFrames(media, signal, progress);
  const detector = new SilenceDetector({ ...settings, sampleRate: track.sampleRate, channels: track.channels, duration: media.duration });
  const { child, done } = startProcess('ffmpeg', audioArgs(media, track), { signal });
  let lastUpdate = 0;
  try {
    await consumePCM(child.stdout, track.channels, samples => {
      detector.push(samples);
      if (Date.now() - lastUpdate > 200) { progress?.({ stage: '음량과 무음 구간 분석', progress: 0.15 + (speechProtection.enabled ? 0.35 : 0.8) * Math.min(1, detector.samples / track.sampleRate / media.duration) }); lastUpdate = Date.now(); }
    });
    await done;
  } catch (error) { child.kill(); throw error; }
  const { candidates, peaks, samples } = detector.finish();
  const initialCuts = createCuts(candidates, settings, media.duration, frames);
  let cuts = initialCuts, protection;
  if (speechProtection.enabled) {
    progress?.({ stage: '로컬 말소리 보호 준비', progress: 0.5 });
    const peak = Math.max(...peaks), gain = peak > 0 ? Math.min(100, Math.max(1, 0.5 / peak)) : 1;
    const vad = await createSpeechDetector({ channels: track.channels, threshold: speechProtection.threshold, duration: media.duration, gain, signal });
    const args = audioArgs(media, { ...track, sampleRate: 16000 });
    let task;
    try {
      task = startProcess('ffmpeg', args, { signal });
      await consumePCM(task.child.stdout, track.channels, async samples => {
        await vad.push(samples);
        if (Date.now() - lastUpdate > 200) { progress?.({ stage: '로컬 말소리 구간 확인', progress: 0.5 + 0.45 * Math.min(1, vad.seconds / media.duration) }); lastUpdate = Date.now(); }
      });
      await task.done;
      const speech = await vad.finish();
      cuts = createCuts(protectSpeech(candidates, speech, media.duration), settings, media.duration, frames);
      protection = { model: VAD_MODEL, intervals: speech, retainedSeconds: Math.max(0, intervalDuration(initialCuts) - intervalDuration(cuts)), analysisGain: gain };
    } catch (error) { task?.child.kill(); if (task) await task.done.catch(() => {}); throw error; }
    finally { await vad.close(); }
  }
  return { settings, speechProtection, protection, trackIndex, candidates, peaks, cuts, decodedSamples: samples };
}

async function writeEditedAudio(media, track, kept, destination, signal, progress, decodeStart = 0, decodeEnd = media.duration) {
  const output = createWriteStream(destination, { flags: 'wx' });
  let outputError;
  output.on('error', error => { outputError = error; });
  const { child, done } = startProcess('ffmpeg', audioArgs(media, track, decodeStart, decodeEnd), { signal });
  const ranges = kept.map(x => ({ start: Math.round(x.start * track.sampleRate), end: Math.round(x.end * track.sampleRate) }));
  let position = Math.round(decodeStart * track.sampleRate), index = 0, lastUpdate = 0, written = 0;
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
      if (Date.now() - lastUpdate > 200) { progress?.({ stage: '오디오 컷 편집', progress: 0.05 + 0.25 * Math.min(1, (position / track.sampleRate - decodeStart) / (decodeEnd - decodeStart)) }); lastUpdate = Date.now(); }
    });
    await done;
    output.end(); await once(output, 'close');
    if (outputError) throw outputError;
    return written;
  } catch (error) { child.kill(); output.destroy(); throw error; }
}

export async function exportCaptions(media, cuts, trackIndex, input, directory, { signal, progress } = {}) {
  getTrack(media, trackIndex);
  const transcript = validateTranscript(input, media.duration);
  if (!transcript || transcript.trackIndex !== trackIndex) throw new Error('현재 오디오 트랙과 자막의 전사 트랙이 다릅니다.');
  const frames = await getFrames(media, signal, progress);
  const { kept } = renderPlan(cuts, media.duration, frames);
  const text = toSRT(transcript, kept);
  signal?.throwIfAborted();
  const id = randomUUID(), destination = path.join(directory, `${id}.srt`);
  try { await writeFile(destination, text, { flag: 'wx', signal }); }
  catch (error) { await rm(destination, { force: true }); throw error; }
  return { id, path: destination, name: media.name.replace(/\.[^.]+$/, '') + '-edited.srt', size: Buffer.byteLength(text), mime: 'application/x-subrip', duration: intervalDuration(kept), kept, verified: true };
}

export async function exportMedia(media, cuts, trackIndex, directory, { signal, progress, preview = false, range, transcript, captionStyle: styleInput, effects: effectsInput, effectAssets } = {}) {
  if (range !== undefined && !preview) throw new Error('범위 지정은 미리보기에서만 사용할 수 있습니다.');
  const track = getTrack(media, trackIndex);
  const frames = await getFrames(media, signal, progress);
  const { removals, kept, sourceRange } = renderPlan(cuts, media.duration, frames, range);
  const captionStyle = validateCaptionStyle(styleInput);
  const effects = validateEffects(effectsInput, media.duration);
  const fullKept = renderPlan(cuts, media.duration, frames).kept;
  const windowStart = sourceRange ? fullKept.reduce((sum, span) => sum + Math.max(0, Math.min(span.end, sourceRange.start) - span.start), 0) : 0;
  const mappedEffects = mapEffects(effects, fullKept, sourceRange ? { start: windowStart, end: windowStart + intervalDuration(kept) } : undefined);
  const subtitles = captionStyle.enabled ? captionCues(transcript, media, trackIndex, renderPlan(cuts, media.duration, frames).kept, kept) : [];
  const expectedDuration = intervalDuration(kept);
  if (!kept.length || expectedDuration <= 0) throw new Error(sourceRange ? '이 범위에는 남아 있는 구간이 없습니다. 범위를 넓히거나 필요한 컷을 복원해 주세요.' : '모든 구간이 제거되었습니다. 내보내려면 일부 구간을 복원해 주세요.');
  // Decode a short lead-in to settle audio timestamps, retaining original PTS.
  const decodeStart = sourceRange ? Math.max(0, Math.floor(sourceRange.start) - 1) : 0;
  const decodeEnd = sourceRange?.end ?? media.duration;
  const id = randomUUID();
  const work = path.join(directory, `${id}.work`);
  await mkdir(work, { recursive: true });
  const pcmPath = path.join(work, 'edited.f32');
  const temporaryOutput = path.join(work, 'output.mp4');
  try {
    const audioSamples = await writeEditedAudio(media, track, kept, pcmPath, signal, progress, decodeStart, decodeEnd);
    const audioMix = await mixEffects(pcmPath, mappedEffects, effects.assets, effectAssets, track, work, { signal, progress });
    let captionRender;
    if (captionStyle.enabled) {
      progress?.({ stage: '자막 디자인 준비', progress: 0.3 });
      captionRender = await renderCaptionImages({ mode: 'sequence', directory: work, width: Math.ceil(media.width / 2) * 2, height: Math.ceil(media.height / 2) * 2, style: captionStyle, cues: subtitles, duration: expectedDuration }, { signal, progress: value => progress?.({ stage: '자막 디자인 합성 준비', progress: .3 + value * .15 }) });
    }
    const { select, offset } = videoExpressions(removals);
    const scale = preview ? ',scale=w=960:h=540:force_original_aspect_ratio=decrease:force_divisible_by=2' : ',pad=ceil(iw/2)*2:ceil(ih/2)*2';
    const trim = sourceRange ? `,trim=start=${sourceRange.start}:end=${sourceRange.end}` : '';
    const base = `[0:${media.videoIndex}]setpts=PTS-(${media.origin})/TB${trim},select='${select}',setpts='PTS-(${offset})/TB'`;
    // Draw on the original pixel canvas, then scale the composed image for
    // preview. Layout and line breaks are identical in preview and export.
    const graph = captionStyle.enabled ? `${base},scale=${media.width}:${media.height},setsar=1,pad=ceil(iw/2)*2:ceil(ih/2)*2[base];[base][2:v]overlay=eof_action=repeat:repeatlast=1:alpha=straight${scale}[v]` : `${base}${scale}[v]`;
    const filterPath = path.join(work, 'filter.txt');
    await writeFile(filterPath, graph);
    const args = ['-v', 'error', '-nostdin', '-copyts', ...seekArgs(media, decodeStart), '-i', media.path, '-f', 'f32le', '-ar', String(track.sampleRate), '-ac', String(track.channels), '-i', pcmPath,
      ...(captionStyle.enabled ? ['-f', 'concat', '-safe', '0', '-protocol_whitelist', 'file,pipe', '-i', path.join(work, 'captions.ffconcat')] : []),
      '-filter_complex_script', filterPath, '-map', '[v]', '-map', '1:a:0', '-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'veryfast', '-crf', preview ? '25' : '18',
      '-pix_fmt', 'yuv420p', '-fps_mode', 'vfr', '-enc_time_base:v', '1:90000', '-video_track_timescale', '90000', '-c:a', 'aac', '-b:a', '192k',
      '-t', expectedDuration.toFixed(9), '-movflags', '+faststart', '-progress', 'pipe:1', '-y', temporaryOutput];
    const { child, done } = startProcess('ffmpeg', args, { signal });
    for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
      if (line.startsWith('out_time_us=')) progress?.({ stage: preview ? '정확한 미리보기 생성' : '영상 렌더링', progress: (captionStyle.enabled ? .45 : .3) + (captionStyle.enabled ? .45 : .6) * Math.min(1, Number(line.split('=')[1]) / 1e6 / expectedDuration) });
    }
    await done;
    progress?.({ stage: '결과 파일 검증', progress: 0.93 });
    const outputInfo = JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', temporaryOutput], { signal }));
    const outputDuration = Number(outputInfo.format.duration);
    const tolerance = Math.max(1 / media.fps, 1024 / track.sampleRate) + 0.005;
    if (Math.abs(outputDuration - expectedDuration) > tolerance) throw new Error(`출력 길이 검증 실패 (${outputDuration.toFixed(3)}초 / 예상 ${expectedDuration.toFixed(3)}초)`);
    if (outputInfo.streams.filter(x => x.codec_type === 'video').length !== 1 || outputInfo.streams.filter(x => x.codec_type === 'audio').length !== 1) throw new Error('출력 트랙 검증에 실패했습니다.');
    await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', temporaryOutput, '-f', 'null', '-'], { signal });
    if (audioMix.mixedClips) Object.assign(audioMix, await inspectMixedOutput(temporaryOutput, track, signal));
    if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError');
    const destination = path.join(directory, `${id}.mp4`);
    await rename(temporaryOutput, destination);
    return { id, path: destination, name: `${path.parse(media.name).name}${preview ? '-preview' : '-hypercut'}.mp4`, duration: outputDuration, expectedDuration, size: (await stat(destination)).size, audioSamples, audioMix, kept, captionStyle, burnedCaptions: captionRender?.cueCount || 0, ...(sourceRange ? { sourceRange } : {}), verified: true };
  } finally { await rm(work, { recursive: true, force: true }); }
}
