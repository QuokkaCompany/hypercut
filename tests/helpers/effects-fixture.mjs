import { writeFile } from 'node:fs/promises';
import { capture } from '../../server/process.mjs';
// The independent oracle is generated directly in samples, without the mixer
// or timeline mapping code. Stereo channels have different known amplitudes.
export async function writeTone(file, { seconds = 3, amplitude = .2, rate = 48000, channels = 1, frequency = 1000 } = {}) {
  const count = Math.round(seconds * rate), pcm = Buffer.alloc(count * channels * 2), header = Buffer.alloc(44);
  for (let frame = 0; frame < count; frame++) for (let channel = 0; channel < channels; channel++) pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * frequency * frame / rate) * amplitude * 32767 * (channel ? .5 : 1)), (frame * channels + channel) * 2);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * channels * 2, 28); header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  await writeFile(file, Buffer.concat([header, pcm])); return { file, pcm, rate, count, channels };
}
export async function writeFlashVideo(file, { channels = 1 } = {}) {
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', "color=c=0x223344:s=640x360:r=30:d=8,drawbox=x=0:y=0:w=60:h=60:color=white:t=fill:enable='gte(t,4)*lt(t,4.5)'", '-f', 'lavfi', '-i', `anullsrc=r=48000:cl=${channels === 1 ? 'mono' : 'stereo'}`, '-t', '8', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-y', file]);
  return file;
}
