import { createReadStream } from 'node:fs';
import { stat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { capture, startProcess } from './process.mjs';
import { consumePCM } from './pcm.mjs';
import { EFFECT_LIMITS } from '../shared/effects.mjs';
const localAudioInput = ['-protocol_whitelist', 'file', '-format_whitelist', 'wav,mp3,mov,flac,ogg,aac'];

export async function inspectEffect(filePath, name, signal) {
  const size = (await stat(filePath)).size;
  if (size > EFFECT_LIMITS.bytes) throw new Error('효과음은 1 GB 이하 파일을 선택해 주세요.');
  const info = JSON.parse(await capture('ffprobe', ['-v', 'error', ...localAudioInput, '-show_format', '-show_streams', '-of', 'json', filePath], { signal }));
  const tracks = info.streams.filter(s => s.codec_type === 'audio'), track = tracks[0];
  if (tracks.length !== 1 || info.streams.some(s => s.codec_type === 'video' && !s.disposition?.attached_pic)) throw new Error('오디오 트랙이 하나인 효과음 파일을 선택해 주세요.');
  const duration = Number(track.duration || info.format.duration);
  if (!Number.isFinite(duration) || duration < .01 || duration > EFFECT_LIMITS.seconds || ![1, 2].includes(track.channels)) throw new Error('효과음은 0.01~300초 길이의 모노 또는 스테레오 파일을 지원합니다.');
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) { signal?.throwIfAborted(); digest.update(chunk); }
  const id = digest.digest('hex');
  return { id, fingerprint: id, name: path.basename(name || filePath), duration, path: filePath, trackIndex: track.index };
}
export function publicEffect({ id, fingerprint, name, duration }) { return { id, fingerprint, name, duration }; }

export async function verifyEffect(asset, expected, signal) {
  if (!asset || asset.fingerprint !== expected.fingerprint || Math.abs(asset.duration - expected.duration) > .001) throw new Error(`효과음 '${expected.name}'을 다시 연결하거나 해당 클립을 음소거해 주세요.`);
  const digest = createHash('sha256');
  try { for await (const chunk of createReadStream(asset.path)) { signal?.throwIfAborted(); digest.update(chunk); } }
  catch (error) { if (signal?.aborted) throw error; throw new Error(`효과음 '${expected.name}'을 읽을 수 없습니다. 다시 연결해 주세요.`); }
  if (digest.digest('hex') !== expected.fingerprint) throw new Error(`효과음 '${expected.name}'의 내용이 변경됐습니다. 원래 음원을 다시 연결해 주세요.`);
}

// Mix float PCM in bounded blocks. FFmpeg decodes each used asset once at the
// selected track's rate/channel count; AAC is still encoded only at final mux.
export async function mixEffects(pcmPath, clips, assets, registry, track, work, { signal, progress } = {}) {
  if (!clips.length) return { mixedClips: 0, peak: null, peakDb: null, overloadedSamples: 0 };
  const sources = new Map(), handles = [];
  let base;
  try {
    for (const id of new Set(clips.map(c => c.assetId))) {
      const expected = assets.find(a => a.id === id), asset = registry?.get(id);
      await verifyEffect(asset, expected, signal);
      progress?.({ stage: `효과음 준비: ${expected.name}`, progress: .3 });
      const file = path.join(work, `fx-${id}.f32`);
      await capture('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', ...localAudioInput, '-i', asset.path, '-map', `0:${asset.trackIndex}`, '-vn', '-af', 'asetpts=PTS-STARTPTS', '-ar', String(track.sampleRate), '-ac', String(track.channels), '-t', String(expected.duration), '-c:a', 'pcm_f32le', '-f', 'f32le', file], { signal });
      const handle = await open(file, 'r'); handles.push(handle);
      const frames = (await handle.stat()).size / 4 / track.channels;
      if (!Number.isInteger(frames) || frames < Math.floor(expected.duration * track.sampleRate) - Math.max(2048, track.sampleRate * .05)) throw new Error(`효과음 '${expected.name}'의 디코딩 길이가 부족합니다.`);
      sources.set(id, { handle, frames });
    }
    base = await open(pcmPath, 'r+');
    const bytesPerFrame = track.channels * 4, size = (await base.stat()).size, block = Buffer.alloc(4096 * bytesPerFrame), added = Buffer.alloc(block.length);
    const schedule = clips.map(c => ({ ...c, first: Math.round(c.start * track.sampleRate), offsetFrame: Math.round(c.offset * track.sampleRate), frames: Math.round(c.duration * track.sampleRate), gain: 10 ** (c.gainDb / 20) }));
    let peak = 0, overloadedSamples = 0;
    let lastUpdate = 0;
    for (let byte = 0; byte < size; byte += block.length) {
      signal?.throwIfAborted();
      if (Date.now() - lastUpdate > 200) { progress?.({ stage: '효과음 음량 합성', progress: .3 }); lastUpdate = Date.now(); }
      const length = Math.min(block.length, size - byte), first = byte / bytesPerFrame, last = first + length / bytesPerFrame;
      await readExact(base, block, length, byte);
      for (const clip of schedule) {
        const source = sources.get(clip.assetId), start = Math.max(first, clip.first), end = Math.min(last, clip.first + clip.frames, clip.first + source.frames - clip.offsetFrame);
        if (end <= start) continue;
        const count = (end - start) * bytesPerFrame;
        await readExact(source.handle, added, count, (clip.offsetFrame + start - clip.first) * bytesPerFrame);
        for (let i = 0; i < count; i += 4) {
          const target = (start - first) * bytesPerFrame + i;
          block.writeFloatLE(block.readFloatLE(target) + added.readFloatLE(i) * clip.gain, target);
        }
      }
      for (let i = 0; i < length; i += 4) {
        const value = Math.abs(block.readFloatLE(i));
        if (!Number.isFinite(value)) throw new Error('효과음 합성에 유효하지 않은 오디오 샘플이 있습니다.');
        peak = Math.max(peak, value); if (value > 1) overloadedSamples++;
      }
      let written = 0;
      while (written < length) { const result = await base.write(block, written, length - written, byte + written); if (!result.bytesWritten) throw new Error('효과음 오디오를 저장하지 못했습니다.'); written += result.bytesWritten; }
    }
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : null;
    if (overloadedSamples) throw new Error(`효과음 합성 음량이 0 dBFS를 넘었습니다 (피크 +${peakDb.toFixed(1)} dBFS, ${overloadedSamples}개 샘플). 효과음 음량을 낮추거나 겹친 클립을 음소거한 뒤 다시 출력해 주세요.`);
    return { mixedClips: clips.length, peak, peakDb, overloadedSamples };
  } finally { await Promise.allSettled([base?.close(), ...handles.map(handle => handle.close())]); }
}
export async function inspectMixedOutput(file, track, signal) {
  const task = startProcess('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-map', '0:a:0', '-vn', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], { signal });
  let peak = 0, overloadedSamples = 0;
  try {
    await consumePCM(task.child.stdout, track.channels, samples => { for (const sample of samples) { if (!Number.isFinite(sample)) throw new Error('출력 오디오 샘플 검증에 실패했습니다.'); peak = Math.max(peak, Math.abs(sample)); if (Math.abs(sample) > 1) overloadedSamples++; } });
    await task.done;
    const peakDb = peak > 0 ? 20 * Math.log10(peak) : null;
    if (overloadedSamples) throw new Error(`AAC 출력 오디오가 0 dBFS를 넘었습니다 (피크 +${peakDb.toFixed(1)} dBFS). 효과음 음량을 낮춰 다시 출력해 주세요.`);
    return { encodedPeak: peak, encodedPeakDb: peakDb, encodedOverloadedSamples: overloadedSamples };
  } catch (error) { task.child.kill(); await task.done.catch(() => {}); throw error; }
}
async function readExact(handle, buffer, length, position) {
  let offset = 0;
  while (offset < length) { const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset); if (!bytesRead) throw new Error('효과음 오디오 파일이 예상보다 일찍 끝났습니다.'); offset += bytesRead; }
}
