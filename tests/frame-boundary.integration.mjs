import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectMedia, exportMedia } from './reference/server/media.mjs';
import { capture } from './reference/server/process.mjs';
import { sha256 } from '../scripts/helpers/transcription-performance-fixture.mjs';

await mkdir('test-output', { recursive: true });
const directory = await mkdtemp(path.resolve('test-output/frame-boundary-'));
const report = { date: new Date().toISOString(), status: 'running', runs: [], sourceHashes: {} };
for (const file of ['server/media.mjs', 'shared/timeline.mjs', 'tests/frame-boundary.integration.mjs']) {
  report.sourceHashes[file] = await sha256(file);
  await copyFile(file, path.join(directory, file.replaceAll('/', '__')));
}

async function frames(file) {
  const probe = JSON.parse(await capture('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_frames', '-show_entries', 'stream=time_base,start_time:frame=best_effort_timestamp', '-of', 'json', file]));
  const [n, d] = probe.streams[0].time_base.split('/').map(Number), tick = n / d;
  return { tick, origin: Number(probe.streams[0].start_time), times: probe.frames.map(frame => Number(frame.best_effort_timestamp) * tick) };
}

async function luminance(file) {
  const output = await capture('ffmpeg', ['-v', 'error', '-xerror', '-nostdin', '-i', file, '-an', '-vf', 'crop=16:16:0:0,signalstats,metadata=print:file=-', '-fps_mode', 'passthrough', '-f', 'null', '-']);
  return output.split('\n').filter(line => line.startsWith('lavfi.signalstats.YAVG=')).map(line => Number(line.split('=')[1]));
}

for (const variant of ['cfr', 'cfr-caption', 'vfr-offset-caption']) test(`fractional cut boundaries preserve every selected frame and PTS (${variant})`, async () => {
  const run = { variant, status: 'running' }; report.runs.push(run);
  try {
    const source = path.join(directory, `${variant}.mp4`), vfr = variant.startsWith('vfr');
    const args = ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', `nullsrc=s=320x180:r=${vfr ? '30000/1001' : '30'}:d=12,geq=lum='16+mod(N*37,180)':cb=128:cr=128`, '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=12'];
    if (vfr) args.push('-vf', "select='if(lt(t,4),not(mod(n,2)),1)'", '-fps_mode', 'vfr');
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0', '-pix_fmt', 'yuv420p', '-c:a', 'aac');
    if (vfr) args.push('-output_ts_offset', '3');
    args.push('-y', source); await capture('ffmpeg', args);
    const input = await frames(source), media = await inspectMedia(source), inputLuma = await luminance(source);
    assert.equal(inputLuma.length, input.times.length);
    const times = input.times.map(time => time - input.origin);
    const cuts = [[83, 105], [161, 190], [241, 270]].map(([a, b], i) => ({ id: `cut-${i}`, start: times[a], end: times[b], enabled: true }));
    const expected = times.flatMap((time, index) => cuts.some(cut => time >= cut.start && time < cut.end) ? [] : [{ index, time: time - cuts.filter(cut => cut.end <= time).reduce((sum, cut) => sum + cut.end - cut.start, 0) }]);
    const options = variant.endsWith('caption') ? { transcript: { trackIndex: 1, channel: 0, language: 'ko', model: 'manual', cues: [{ id: 'a', start: .5, end: 1.5, text: '프레임 경계 검증' }] }, captionStyle: { enabled: true, preset: 'emphasis', sizePercent: 4.5, position: 'bottom', marginPercent: 8 } } : {};
    const output = await exportMedia(media, cuts, 1, directory, options), actual = await frames(output.path), outputLuma = await luminance(output.path);
    Object.assign(run, { source, sourceSHA256: media.fingerprint, cuts, expected, output, outputSHA256: await sha256(output.path), actual, inputLuma, outputLuma });
    assert.equal(actual.times.length, expected.length, 'Kept frame count');
    assert.equal(outputLuma.length, expected.length, 'Decoded frame count');
    let maxClockError = 0, maxLumaError = 0;
    for (const [i, frame] of expected.entries()) {
      const clockError = Math.abs(actual.times[i] - frame.time), lumaError = Math.abs(outputLuma[i] - inputLuma[frame.index]);
      assert.ok(clockError <= actual.tick * 1.5 + 1e-9, `Frame ${i} clock: ${clockError}`);
      assert.ok(lumaError <= 3, `Frame ${i} source identity: ${lumaError}`);
      maxClockError = Math.max(maxClockError, clockError); maxLumaError = Math.max(maxLumaError, lumaError);
    }
    assert.equal(await sha256(source), media.fingerprint);
    Object.assign(run, { status: 'PASS', maxClockError, maxLumaError });
  } catch (error) { run.status = 'FAIL'; run.error = error.stack; throw error; }
});

test.after(async () => {
  report.status = report.runs.every(run => run.status === 'PASS') ? 'completed' : 'failed';
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, reportFile: path.join(directory, 'results.json') }));
});
