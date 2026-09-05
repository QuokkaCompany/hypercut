import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateDemo } from '../scripts/fixtures.mjs';
import { inspectMedia, analyzeMedia, exportMedia } from '../server/media.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { capture } from '../server/process.mjs';

let directory, source, media;
before(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-errors-')); source = await generateDemo(path.join(directory, 'source.mp4')); media = await inspectMedia(source); });
after(async () => { await rm(directory, { recursive: true, force: true }); });

test('E05: missing and crashing media executable fail, then normal analysis succeeds', async () => {
  const original = process.env.FFMPEG_PATH;
  try {
    process.env.FFMPEG_PATH = path.join(directory, 'missing-ffmpeg');
    await assert.rejects(analyzeMedia(media, DEFAULT_SETTINGS, 1), /찾을 수 없습니다/);
    const crashing = path.join(directory, 'crash'); await writeFile(crashing, '#!/bin/sh\nexit 71\n', { mode: 0o700 }); process.env.FFMPEG_PATH = crashing;
    await assert.rejects(analyzeMedia(media, DEFAULT_SETTINGS, 1), /작업 실패/);
  } finally { if (original === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = original; }
  assert.equal((await analyzeMedia(media, DEFAULT_SETTINGS, 1)).cuts.length, 5);
  assert.equal((await inspectMedia(source)).fingerprint, media.fingerprint);
});
test('E02: real filesystem destination failure preserves source and permits retry', async () => {
  const badDirectory = path.join(directory, 'regular-file'); await writeFile(badDirectory, 'existing data');
  await assert.rejects(exportMedia(media, [], 1, badDirectory), /ENOTDIR/);
  assert.equal((await inspectMedia(source)).fingerprint, media.fingerprint);
  const output = await exportMedia(media, [], 1, directory); assert.equal(output.verified, true);
  assert.equal((await readdir(directory)).filter(name => name.endsWith('.work')).length, 0);
});
test('E05: corrupt, unsupported codec and missing-audio inputs return clear outcomes', async () => {
  const corrupt = path.join(directory, 'corrupt.mp4'); await writeFile(corrupt, 'not a video');
  await assert.rejects(inspectMedia(corrupt), /ffprobe 작업 실패/);
  const silent = path.join(directory, 'no-audio.mp4');
  await capture('ffmpeg', ['-v','error','-i',source,'-map','0:v:0','-c','copy','-an','-t','1','-y',silent]);
  const noAudio = await inspectMedia(silent); assert.equal(noAudio.audioTracks.length, 0);
  await assert.rejects(analyzeMedia(noAudio, DEFAULT_SETTINGS, 1), /오디오 트랙/);
  const unsupported = path.join(directory, 'mpeg4.mp4');
  await capture('ffmpeg', ['-v','error','-i',source,'-t','0.2','-c:v','mpeg4','-an','-y',unsupported]);
  await assert.rejects(inspectMedia(unsupported), /H.264/);
});
