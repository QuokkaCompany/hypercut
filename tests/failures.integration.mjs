import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, readFile, chmod } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { generateDemo } from '../scripts/fixtures.mjs';
import { inspectMedia, analyzeMedia, exportMedia } from './reference/server/media.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { capture, executable } from './reference/server/process.mjs';

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
test('E05: an unreadable original produces an OS error and can be reopened after permission recovery', async () => {
  try { await chmod(source, 0o000); await assert.rejects(inspectMedia(source), /Permission denied|Operation not permitted/); }
  finally { await chmod(source, 0o600); }
  assert.equal((await inspectMedia(source)).fingerprint, media.fingerprint);
});
test('E02: killing an actual FFmpeg during audio export cleans partial output and permits retry', {timeout:15000}, async () => {
  const original=process.env.FFMPEG_PATH, binary=executable('ffmpeg');
  const wrapper=path.join(directory,'slow-ffmpeg.mjs'), pidFile=path.join(directory,'ffmpeg.pid');
  await writeFile(wrapper, `#!/usr/bin/env node\nimport {spawn} from 'node:child_process';\nimport {writeFileSync} from 'node:fs';\nconst child=spawn(${JSON.stringify(binary)},['-re',...process.argv.slice(2)],{stdio:'inherit'});\nwriteFileSync(${JSON.stringify(pidFile)},String(child.pid));\nchild.on('exit',code=>{process.exitCode=code??1});\nprocess.on('SIGTERM',()=>child.kill('SIGTERM'));\n`, {mode:0o700});
  let pid;
  try {
    process.env.FFMPEG_PATH=wrapper;
    const outcome=exportMedia(media,[],1,directory).then(value=>({value}),error=>({error}));
    for(let i=0;i<100;i++){const text=await readFile(pidFile,'utf8').catch(()=>null);if(text){pid=Number(text);break;}await new Promise(resolve=>setTimeout(resolve,10));}
    assert.ok(pid); process.kill(pid,'SIGKILL');
    const result=await outcome; assert.ok(result.error); assert.match(result.error.message,/작업 실패|중단/);
  } finally { if(original===undefined)delete process.env.FFMPEG_PATH;else process.env.FFMPEG_PATH=original; if(pid)try{process.kill(pid,'SIGTERM');}catch{} }
  assert.equal((await readdir(directory)).filter(name=>name.endsWith('.work')).length,0);
  assert.equal((await inspectMedia(source)).fingerprint,media.fingerprint);
  assert.equal((await exportMedia(media,[],1,directory)).verified,true);
});
