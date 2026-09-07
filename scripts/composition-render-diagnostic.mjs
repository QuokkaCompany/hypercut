import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { inspectMedia, analyzeMedia, exportMedia, exportCaptions } from '../tests/reference/server/media.mjs';
import { inspectEffect } from '../tests/reference/server/effects.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { compositionFixture, verifyCompositionAudio, verifyCompositionVideo } from './helpers/composition-performance-fixture.mjs';
import { expectedComposition, verifyCompositionSRT } from './helpers/composition-oracle.mjs';
import { verifyThresholdFrames, verifyThresholdSync } from './helpers/threshold-performance-fixture.mjs';
import { rssSampler } from './helpers/performance.mjs';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';

const output = path.resolve(process.argv.find(value => value.startsWith('--output='))?.slice(9) || 'test-output/composition-render-diagnostic');
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
assert.equal(await stat(path.join(output, 'results.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null);
const report = { date: new Date().toISOString(), status: 'running', scope: 'One 60-second backend-only composition. RSS covers this Node process and all descendants during export, including the small diagnostic driver. No browser, Mac UI, long-video performance or human-quality claim.', sourceHashes: {} };
for (const file of ['server/media.mjs', 'shared/timeline.mjs', 'server/caption-rendering.mjs', 'server/caption-render-worker.mjs', 'scripts/composition-render-diagnostic.mjs']) report.sourceHashes[file] = await sha256(file);
let sampler;
try {
  const input = await compositionFixture(60, output), media = await inspectMedia(input.source), effect = await inspectEffect(input.effectFile);
  const analysis = await analyzeMedia(media, DEFAULT_SETTINGS, input.data.transcript.trackIndex);
  const expected = expectedComposition(media.duration, analysis.cuts, input.data);
  Object.assign(report, { input, analysis, expected });
  const stages = [];
  sampler = rssSampler([process.pid]); await sampler.start(); const start = performance.now();
  const result = await exportMedia(media, analysis.cuts, input.data.transcript.trackIndex, output, { ...input.data, effectAssets: new Map([[effect.id, effect]]), progress: value => { if (stages.at(-1)?.stage !== value.stage) stages.push({ ...value, milliseconds: performance.now() - start }); } });
  const exportSeconds = (performance.now() - start) / 1000, resources = await sampler.stop(); sampler = undefined;
  await writeFile(path.join(output, 'resources.json'), JSON.stringify(resources, null, 2)); assert.deepEqual(resources.errors, []);
  Object.assign(report, { result, exportSeconds, stages, peakRSSBytes: resources.peakBytes, outputSHA256: await sha256(result.path) });
  const srt = await exportCaptions(media, analysis.cuts, input.data.transcript.trackIndex, input.data.transcript, output);
  report.srtEvidence = verifyCompositionSRT(await readFile(srt.path, 'utf8'), expected.captions);
  report.videoEvidence = await verifyCompositionVideo(result.path, expected, output);
  report.audioEvidence = await verifyCompositionAudio(result.path, expected);
  report.frameEvidence = await verifyThresholdFrames(input, result.path, analysis.cuts);
  report.syncEvidence = await verifyThresholdSync(input, result.path, analysis.cuts, output);
  assert.equal(await sha256(input.source), input.media.fingerprint); assert.equal(await sha256(input.effectFile), input.effectFingerprint);
  report.status = 'completed'; report.visualReview = 'NOT_RUN';
} catch (error) { report.status = 'failed'; report.error = error.stack; process.exitCode = 1; }
finally {
  if (sampler) await writeFile(path.join(output, 'failed-resources.json'), JSON.stringify(await sampler.stop(), null, 2));
  await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify({ status: report.status, exportSeconds: report.exportSeconds, peakRSSBytes: report.peakRSSBytes, reportPath: path.join(output, 'results.json') }));
