import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { capture } from '../server/process.mjs';
import { sha256 } from '../scripts/helpers/transcription-performance-fixture.mjs';
import { verifyCompositionAudio, verifyCompositionVideo } from '../scripts/helpers/composition-performance-fixture.mjs';

await mkdir('test-output', { recursive: true });
const directory = await mkdtemp(path.resolve('test-output/composition-oracle-'));
const report = { date: new Date().toISOString(), status: 'running', scope: 'Independent oracle calibration with generated H.264/AAC files. Yellow rectangles calibrate caption presence, not Korean glyph quality. Invalid timing, gain, missing/extra content and dropped frames must be rejected.', sourceHashes: {}, runs: [] };
for (const file of ['scripts/helpers/composition-oracle.mjs', 'scripts/helpers/composition-performance-fixture.mjs', 'tests/composition-oracle.integration.mjs']) report.sourceHashes[file] = await sha256(file);
const expected = { duration: 3, effects: [{ id: 'audible', start: 1, end: 1.25, amplitude: .05 }], captions: [{ id: 'one', start: .8, end: 2.2, text: 'calibration rectangle' }] };
async function fixture(name, { gain = .05, effectShift = 0, extraEffect = false, captionShift = 0, missingCaption = false, extraCaption = false, droppedFrame = false } = {}) {
  const file = path.join(directory, `${name}.mp4`);
  const caption = missingCaption ? '0' : `gte(t,${.8 + captionShift})*lt(t,${2.2 + captionShift})`;
  const visible = extraCaption ? `(${caption})+gte(t,0.1)*lt(t,0.3)` : caption;
  const video = `color=c=0x243023:s=320x180:r=30:d=3,drawbox=x=40:y=135:w=240:h=24:color=0xffe16b:t=fill:enable='${visible}'`;
  const audio = `aevalsrc='0.15*sin(2*PI*440*t)+${gain}*sin(2*PI*880*t)*gte(t,${1 + effectShift})*lt(t,${1.25 + effectShift})${extraEffect ? '+0.05*sin(2*PI*880*t)*gte(t,2)*lt(t,2.25)' : ''}':s=48000:d=3`;
  await capture('ffmpeg', ['-v', 'error', '-nostdin', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', audio, ...(droppedFrame ? ['-vf', "select='not(eq(n,5))'", '-fps_mode', 'vfr'] : []), '-c:v', 'libx264', '-threads:v', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-t', '3', '-y', file]);
  return file;
}
async function record(name, file, fn) {
  const entry = { name, file, sha256: await sha256(file), status: 'running' }; report.runs.push(entry);
  try { Object.assign(entry, await fn()); entry.status = 'PASS'; }
  catch (error) { entry.status = 'FAIL'; entry.error = error.stack; throw error; }
}
async function rejection(fn, pattern) {
  let error;
  try { await fn(); } catch (cause) { error = cause; }
  assert.ok(error, 'Oracle accepted an intentionally invalid output'); assert.match(error.message, pattern);
  return { expectedRejection: true, error: error.message };
}
const valid = await fixture('valid');
test('composition audio oracle accepts actual AAC alongside the source tone', async () => {
  await record('valid AAC', valid, async () => ({ evidence: await verifyCompositionAudio(valid, expected) }));
});
test('composition frame oracle accepts exact H.264 presence and checks every frame', async () => {
  await record('valid H264', valid, async () => ({ evidence: await verifyCompositionVideo(valid, expected, directory, { width: 320, height: 180, saveFrames: false }) }));
});
test('AAC oracle rejects missing, 200ms delayed, half-gain and extra effects', async () => {
  for (const [name, options, pattern] of [
    ['missing-effect', { gain: 0 }, /Effect gain|Missing effect/],
    ['shifted-effect', { effectShift: .2 }, /Effect gain|Unexpected effect|boundary/],
    ['wrong-gain', { gain: .025 }, /Effect gain/],
    ['extra-effect', { extraEffect: true }, /Unexpected effect/]
  ]) { const file = await fixture(name, options); await record(name, file, () => rejection(() => verifyCompositionAudio(file, expected), pattern)); }
});
test('H.264 oracle rejects missing, 200ms shifted, extra captions and a dropped frame', async () => {
  for (const [name, options, pattern] of [
    ['missing-caption', { missingCaption: true }, /Caption presence|Missing caption/],
    ['shifted-caption', { captionShift: .2 }, /Caption presence/],
    ['extra-caption', { extraCaption: true }, /Caption presence/],
    ['dropped-frame', { droppedFrame: true }, /frame count/]
  ]) { const file = await fixture(name, options); await record(name, file, () => rejection(() => verifyCompositionVideo(file, expected, directory, { width: 320, height: 180, saveFrames: false }), pattern)); }
});
test.after(async () => {
  report.status = report.runs.length === 10 && report.runs.every(run => run.status === 'PASS') ? 'completed' : 'failed';
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, reportFile: path.join(directory, 'results.json') }));
});
