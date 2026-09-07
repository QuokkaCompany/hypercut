import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { capture } from '../reference/server/process.mjs';

const exec = promisify(execFile);
export async function speechFixture(directory, { channels = 'mono', sampleRate = 48000, offset = 0 } = {}) {
  await mkdir(directory, { recursive: true });
  const speech = path.join(directory, 'generated-korean.aiff');
  const text = '작은 목소리도 남겨 주세요. 긴 무음만 줄이면 됩니다.';
  await exec('/usr/bin/say', ['-v', 'Eddy (Korean (South Korea))', '-r', '160', '-o', speech, text]);
  const spokenDuration = Number(JSON.parse(await capture('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', speech])).format.duration);
  const duration = 2 * spokenDuration + 5;
  const decodedPath = path.join(directory, 'generated-mono.f32');
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-i', speech, '-ar', String(sampleRate), '-f', 'f32le', '-ac', '1', '-t', String(spokenDuration + 0.1), '-fs', '10000000', '-y', decodedPath]);
  const decoded = await readFile(decodedPath);
  const values = new Float32Array(decoded.buffer, decoded.byteOffset, decoded.length / 4);
  let peak = 0; for (const value of values) peak = Math.max(peak, Math.abs(value));
  const count = channels === 'mono' ? 1 : 2, data = new Float32Array(Math.round(duration * sampleRate) * count);
  for (const start of [1, spokenDuration + 4]) for (let i = 0; i < values.length; i++) {
    const value = values[i] * 0.004 / peak, index = Math.round(start * sampleRate) + i;
    data[index * count] = channels === 'right' ? 0 : value;
    if (count === 2) data[index * 2 + 1] = channels === 'opposite' ? -value : value;
  }
  const pcm = path.join(directory, 'speech.f32'); await writeFile(pcm, Buffer.from(data.buffer));
  const video = path.join(directory, 'quiet-korean.mp4');
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `color=c=0x334455:size=320x180:rate=30:duration=${duration}`,
    '-f', 'f32le', '-ar', String(sampleRate), '-ac', String(count), '-i', pcm,
    '-vf', `setpts=PTS+${offset}/TB`, '-af', `asetpts=PTS+${offset}/TB`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-y', video]);
  return { video, speech, sampleRate, channels: count, offset, duration, spokenDuration, spoken: [{ start: 1, end: 1 + spokenDuration }, { start: spokenDuration + 4, end: spokenDuration * 2 + 4 }], middleSilence: { start: spokenDuration + 1, end: spokenDuration + 4 }, text, pcmSHA256: createHash('sha256').update(Buffer.from(data.buffer)).digest('hex') };
}
