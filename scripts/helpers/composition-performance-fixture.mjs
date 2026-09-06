import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { capture, startProcess } from '../../server/process.mjs';
import { writeTone } from '../../tests/helpers/effects-fixture.mjs';
import { thresholdFixture } from './threshold-performance-fixture.mjs';
import { sha256 } from './transcription-performance-fixture.mjs';
import { COMPOSITION_TONE, compositionData, CompositionAudioOracle, CompositionCaptionOracle } from './composition-oracle.mjs';

export async function compositionFixture(seconds, directory) {
  const input = await thresholdFixture(seconds);
  await mkdir(directory, { recursive: true });
  const effectFile = path.resolve(directory, 'composition-880hz.wav');
  await writeTone(effectFile, COMPOSITION_TONE);
  const fingerprint = await sha256(effectFile);
  const asset = { id: fingerprint, fingerprint, name: path.basename(effectFile), duration: COMPOSITION_TONE.seconds };
  const data = compositionData(seconds, asset, input.media.audioTracks[0].index);
  const fixture = { ...input, effectFile, effectFingerprint: fingerprint, tone: COMPOSITION_TONE, data };
  await writeFile(path.join(directory, 'composition-fixture.json'), JSON.stringify(fixture, null, 2) + '\n');
  return fixture;
}

export async function verifyCompositionAudio(file, expected) {
  const oracle = new CompositionAudioOracle(expected);
  const task = startProcess('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1']);
  let pending = Buffer.alloc(0);
  try {
    for await (const chunk of task.child.stdout) {
      const bytes = pending.length ? Buffer.concat([pending, chunk]) : chunk, length = bytes.length - bytes.length % 4;
      for (let i = 0; i < length; i += 4) oracle.sample(bytes.readFloatLE(i));
      pending = Buffer.from(bytes.subarray(length));
    }
    await task.done; assert.equal(pending.length, 0, 'Partial decoded PCM sample');
    return oracle.finish();
  } catch (error) { task.child.kill(); await task.done.catch(() => {}); throw error; }
}

export async function verifyCompositionVideo(file, expected, directory, { width = 1920, height = 1080, saveFrames = true } = {}) {
  const info = JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const videos = info.streams.filter(s => s.codec_type === 'video'), audios = info.streams.filter(s => s.codec_type === 'audio');
  assert.equal(videos.length, 1); assert.equal(audios.length, 1); assert.equal(videos[0].codec_name, 'h264'); assert.equal(audios[0].codec_name, 'aac');
  assert.equal(videos[0].width, width); assert.equal(videos[0].height, height); assert.equal(audios[0].channels, 1); assert.equal(Number(audios[0].sample_rate), 48000);
  assert.ok(Math.abs(Number(info.format.duration) - expected.duration) <= 1 / 30 + 1e-7, 'Encoded composition duration');
  const times = (await capture('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', file])).split('\n').map(line => line.split(',')[0].trim()).filter(Boolean).map(Number);
  const oracle = new CompositionCaptionOracle(expected);
  const sampleWidth = 160, sampleHeight = 30, stride = sampleWidth * sampleHeight * 3, frame = Buffer.alloc(stride);
  const task = startProcess('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-an', '-vf', `crop=iw:ih/3:0:ih*2/3,scale=${sampleWidth}:${sampleHeight}`, '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1']);
  let used = 0, index = 0;
  try {
    for await (const chunk of task.child.stdout) {
      let offset = 0;
      while (offset < chunk.length) {
        const count = Math.min(stride - used, chunk.length - offset);
        chunk.copy(frame, used, offset, offset + count); used += count; offset += count;
        if (used !== stride) continue;
        let yellow = 0;
        for (let i = 0; i < stride; i += 3) { const r = frame[i], g = frame[i + 1], b = frame[i + 2]; if (r > 145 && g > 125 && b < 160 && r - b > 55 && g - b > 30) yellow++; }
        assert.ok(index < times.length, 'More decoded frames than timestamps');
        oracle.frame(times[index++], yellow); used = 0;
      }
    }
    await task.done; assert.equal(used, 0); assert.equal(index, times.length);
  } catch (error) { task.child.kill(); await task.done.catch(() => {}); throw error; }
  const result = oracle.finish(), frames = [];
  if (saveFrames) {
    await mkdir(directory, { recursive: true });
    for (const cueIndex of [...new Set([0, Math.floor(expected.captions.length / 2), expected.captions.length - 1])]) {
      const cue = expected.captions[cueIndex], time = (cue.start + cue.end) / 2, destination = path.resolve(directory, `caption-${cueIndex + 1}.png`);
      await capture('ffmpeg', ['-v', 'error', '-nostdin', '-ss', String(time), '-i', file, '-frames:v', '1', '-y', destination]);
      frames.push({ cueIndex, text: cue.text, time, path: destination, sha256: await sha256(destination) });
    }
  }
  return { ...result, encodedDuration: Number(info.format.duration), width, height, sampleWidth, sampleHeight, framesForVisualReview: frames, scope: 'Every output frame checked for yellow-caption presence and timing. Exact text is checked in SRT; exported sample frames require visual review. This does not OCR every glyph.' };
}

export async function readCompositionSRT(file) { return readFile(file, 'utf8'); }
