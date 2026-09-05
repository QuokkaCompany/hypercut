import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { capture } from '../server/process.mjs';
import { inspectMedia, analyzeMedia, exportMedia } from '../server/media.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';

for (const fps of ['24', '25', '30000/1001', '30', '60']) for (const container of ['mp4', 'mov']) test(`M04 representative: ${container} H264/AAC ${fps} fps, ${container === 'mp4' ? 'mono 48k' : 'stereo 44.1k'}`, { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-format-'));
  try {
    const source = path.join(directory, `input.${container}`), sampleRate = container === 'mp4' ? 48000 : 44100;
    await capture('ffmpeg', ['-v','error','-f','lavfi','-i',`color=c=blue:s=320x180:r=${fps}:d=2`,'-f','lavfi','-i',`aevalsrc='0.2*sin(2*PI*440*t)*lt(t,1)':s=${sampleRate}:d=2`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-ac',container === 'mp4' ? '1' : '2','-shortest','-y',source]);
    const media = await inspectMedia(source);
    assert.equal(media.audioTracks[0].sampleRate, sampleRate);
    const analysis = await analyzeMedia(media, DEFAULT_SETTINGS, media.audioTracks[0].index);
    assert.equal(analysis.cuts.length, 1);
    const output = await exportMedia(media, analysis.cuts, media.audioTracks[0].index, directory);
    assert.equal(output.verified, true); assert.ok(output.duration > 1.1 && output.duration < 1.25);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
