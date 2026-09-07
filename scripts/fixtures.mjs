import { mkdir, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { capture } from '../tests/reference/server/process.mjs';

export async function generateDemo(output) {
  try { await access(output); return output; } catch {}
  await mkdir(path.dirname(output), { recursive: true });
  const args = ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=30:duration=16', '-f', 'lavfi', '-i', "aevalsrc='0.18*sin(2*PI*330*t)*if(between(t,1,3)+between(t,5,8)+between(t,10,12)+between(t,14,15),1,0)':s=48000:d=16", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-shortest', '-y', output];
  await capture('ffmpeg', args);
  return output;
}

export function pcmWav(samples, sampleRate = 48000, channels = 1) {
  const data = Buffer.alloc(samples.length * 4);
  samples.forEach((value, i) => data.writeFloatLE(value, i * 4));
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + data.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(3, 20); header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * channels * 4, 28);
  header.writeUInt16LE(channels * 4, 32); header.writeUInt16LE(32, 34); header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const output = path.resolve('tests/fixtures/generated/demo.mp4');
  await generateDemo(output);
  await writeFile(path.join(path.dirname(output), 'manifest.json'), JSON.stringify({ id: 'demo-16s-v1', type: 'synthetic-tone-not-speech', duration: 16, soundIntervals: [[1,3],[5,8],[10,12],[14,15]], note: 'AAC boundaries must be measured on decoded PCM, not assumed from pre-encoding intervals.' }, null, 2));
  console.log(output);
}
