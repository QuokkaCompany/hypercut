import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateDemo } from '../scripts/fixtures.mjs';
import { inspectMedia, analyzeMedia, exportMedia, playbackFile } from '../server/media.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { capture } from '../server/process.mjs';

test('G1: actual decode, sample analysis, frame-aligned cut and verified MP4 export', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-media-'));
  try {
    const source = path.join(directory, "한글 ' 영상 $test.mp4");
    await generateDemo(source);
    const media = await inspectMedia(source);
    assert.equal(media.duration, 16); assert.equal(media.audioTracks.length, 1);
    const analysis = await analyzeMedia(media, DEFAULT_SETTINGS, media.audioTracks[0].index);
    assert.equal(analysis.cuts.length, 5);
    assert.ok(analysis.cuts[0].start === 0 && Math.abs(analysis.cuts[0].end - 0.9) < 0.04);
    assert.ok(Math.abs(analysis.cuts[1].start - 3.15) < 0.07);
    const cuts = [{ id: 'known-1', start: 3, end: 5, enabled: true }, { id: 'known-2', start: 8, end: 10, enabled: true }];
    const result = await exportMedia(media, cuts, media.audioTracks[0].index, directory);
    assert.ok(Math.abs(result.duration - 12) <= 1 / 30 + 0.001);
    assert.equal(result.audioSamples, 12 * 48000);
    assert.equal(result.verified, true);
    assert.ok((await stat(result.path)).size > 1000);
    const frameCount = JSON.parse(await capture('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'json', result.path]));
    assert.equal(Number(frameCount.streams[0].nb_read_frames), 360);
    assert.equal((await inspectMedia(source)).fingerprint, media.fingerprint);
    await assert.rejects(exportMedia(media, [{ start: 0, end: 16, enabled: true }], media.audioTracks[0].index, directory), /모든 구간/);
    console.log(JSON.stringify({ analysisCuts: analysis.cuts, outputDuration: result.duration, frames: 360, audioSamples: result.audioSamples, sourceUnchanged: true }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function flashOnsets(file) {
  const metadata = await capture('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'setpts=PTS-STARTPTS,signalstats,metadata=print:file=-', '-an', '-f', 'null', '-']);
  const onsets = []; let time = 0, active = false;
  for (const line of metadata.split('\n')) {
    const match = line.match(/pts_time:([\d.]+)/); if (match) time = Number(match[1]);
    if (line.startsWith('lavfi.signalstats.YAVG=')) { const white = Number(line.split('=')[1]) > 200; if (white && !active) onsets.push(time); active = white; }
  }
  return onsets;
}

async function beepOnsets(file, destination) {
  await capture('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-y', destination]);
  const pcm = await readFile(destination), onsets = []; let active = false, lastLoud = -10000;
  for (let i = 0; i < pcm.length / 4; i++) {
    if (Math.abs(pcm.readFloatLE(i * 4)) > 0.2) { if (!active) onsets.push(i / 48000); active = true; lastLoud = i; }
    else if (i - lastLoud > 2400) active = false;
  }
  return onsets;
}

for (const variant of ['cfr', 'vfr', 'offset']) test(`M02/M03: independent flash/beep sync after multiple cuts (${variant})`, { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-sync-'));
  try {
    const source = path.join(directory, 'source.mp4');
    const flash = "color=c=black:s=160x90:r=30:d=12,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(n,15,17)+between(n,90,92)+between(n,180,182)+between(n,300,302)+between(n,345,347)'";
    const tone = "aevalsrc='0.6*sin(2*PI*1000*t)*if(between(t,0.5,0.6)+between(t,3,3.1)+between(t,6,6.1)+between(t,10,10.1)+between(t,11.5,11.6),1,0)':s=48000:d=12";
    const args = ['-v', 'error', '-f', 'lavfi', '-i', flash, '-f', 'lavfi', '-i', tone];
    if (variant === 'vfr') args.push('-vf', "select='if(lt(t,6),not(mod(n,2)),1)'", '-fps_mode', 'vfr');
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-b:a', '192k');
    if (variant === 'offset') args.push('-output_ts_offset', '3');
    args.push('-y', source); await capture('ffmpeg', args);
    const media = await inspectMedia(source);
    const cuts = [{ start: 1.2, end: 2.4, enabled: true }, { start: 4.2, end: 5.2, enabled: true }, { start: 8.4, end: 9.8, enabled: true }];
    const result = await exportMedia(media, cuts, media.audioTracks[0].index, directory);
    const flashes = await flashOnsets(result.path), beeps = await beepOnsets(result.path, path.join(directory, 'out.f32'));
    const expectedAudio = [0.5, 1.8, 3.8, 6.4, 7.9];
    const expectedVideo = [...expectedAudio]; if (variant === 'vfr') expectedVideo[0] += 1 / 30;
    assert.equal(flashes.length, 5); assert.equal(beeps.length, 5);
    for (let i = 0; i < 5; i++) {
      assert.ok(Math.abs(flashes[i] - expectedVideo[i]) < 0.001, `flash ${i}: ${flashes[i]} vs ${expectedVideo[i]}`);
      assert.ok(Math.abs(beeps[i] - expectedAudio[i]) < 0.005, `beep ${i}: ${beeps[i]} vs ${expectedAudio[i]}`);
      assert.ok(Math.abs((flashes[i] - beeps[i]) - (expectedVideo[i] - expectedAudio[i])) < 0.005);
    }
    assert.ok(Math.abs(result.duration - 8.4) < 1 / 30 + 0.001);
    if (variant === 'offset') {
      const playback = await playbackFile(media, media.audioTracks[0].index, directory);
      const info = await inspectMedia(playback);
      assert.ok(Math.abs(info.origin) < 0.001); assert.ok(Math.abs(info.duration - 12) < 0.001);
    }
    console.log(JSON.stringify({ variant, flashes, beeps, outputDuration: result.duration, syncToleranceSeconds: 0.005 }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('D09/M05: selected audio track controls analysis, source playback and export', { timeout: 120000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-tracks-'));
  try {
    const source = path.join(directory, 'tracks.mov');
    await capture('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:r=30:d=4', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=4:sample_rate=44100', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-map', '0:v', '-map', '1:a', '-map', '2:a', '-t', '4', '-c:v', 'libx264', '-c:a', 'aac', '-y', source]);
    const media = await inspectMedia(source);
    const first = await analyzeMedia(media, DEFAULT_SETTINGS, media.audioTracks[0].index);
    const second = await analyzeMedia(media, DEFAULT_SETTINGS, media.audioTracks[1].index);
    assert.equal(first.cuts.length, 0); assert.deepEqual(second.cuts.map(x => [x.start, x.end]), [[0, 4]]);
    const playback = await playbackFile(media, media.audioTracks[1].index, directory);
    const playbackInfo = await inspectMedia(playback);
    assert.equal(playbackInfo.audioTracks.length, 1); assert.equal(playbackInfo.audioTracks[0].channels, 2);
    assert.deepEqual(await beepOnsets(playback, path.join(directory, 'playback.f32')), []);
    const output = await exportMedia(media, [], media.audioTracks[1].index, directory);
    assert.deepEqual(await beepOnsets(output.path, path.join(directory, 'export.f32')), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
