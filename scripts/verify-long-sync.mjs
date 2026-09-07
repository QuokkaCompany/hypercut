import { readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { capture } from '../tests/reference/server/process.mjs';

const directory = path.resolve('test-output/benchmark');
const report = JSON.parse(await readFile(path.join(directory, 'results.json'), 'utf8'));
async function markers(file, duration) {
  const seek = Math.floor(duration) - 8;
  const metadata = await capture('ffmpeg', ['-v','error','-ss',String(seek),'-i',file,'-t','8','-vf','signalstats,metadata=print:file=-','-an','-f','null','-']);
  let time = 0, active = false; const flashes = [];
  for (const line of metadata.split('\n')) {
    const match = line.match(/pts_time:([\d.]+)/); if (match) time = Number(match[1]);
    if (line.startsWith('lavfi.signalstats.YAVG=')) { const white = Number(line.split('=')[1]) > 200; if (white && !active) flashes.push(time); active = white; }
  }
  const pcmFile = path.join(directory, 'tail.f32');
  await capture('ffmpeg', ['-v','error','-ss',String(seek),'-i',file,'-t','8','-map','0:a:0','-f','f32le','-ac','1','-ar','48000','-y',pcmFile]);
  const pcm = await readFile(pcmFile), tones = []; let loud = false, last = -10000;
  for (let i = 0; i < pcm.length / 4; i++) {
    if (Math.abs(pcm.readFloatLE(i*4)) > 0.07) { if (!loud) tones.push(i/48000); loud = true; last = i; }
    else if (i - last > 2400) loud = false;
  }
  await rm(pcmFile);
  const gaps = flashes.map(flash => { const tone = tones.filter(tone => tone > 0.1 && tone < flash).at(-1); return tone === undefined ? null : flash-tone; }).filter(gap => gap !== null && gap < 1);
  return { seek, flashes, tones, gaps };
}
const source = await markers(path.join(directory, '3600s.mp4'), 3600);
const output = await markers(report.output3600, report.runs.at(-1).outputSeconds);
assert.ok(source.gaps.length >= 2 && output.gaps.length >= 2);
const extraErrorSeconds = output.gaps.slice(-2).map((gap,index)=>gap-source.gaps.slice(-2)[index]);
for (const error of extraErrorSeconds) assert.ok(Math.abs(error) < 0.005, `extra A/V drift ${error}`);
const result = { status: 'PASS', scope: 'Independent final two flash/tone pairs after 1,000 cuts; synthetic source has a 400ms flash delay by design.', source, output, extraErrorSeconds, toleranceSeconds: 0.005 };
await writeFile(path.join(directory, 'long-sync.json'), JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
