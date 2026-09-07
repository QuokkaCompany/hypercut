import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectMedia, analyzeMedia, exportMedia, exportCaptions } from './reference/server/media.mjs';
import { inspectEffect } from './reference/server/effects.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { compositionFixture, verifyCompositionAudio, verifyCompositionVideo } from '../scripts/helpers/composition-performance-fixture.mjs';
import { expectedComposition, verifyCompositionSRT } from '../scripts/helpers/composition-oracle.mjs';
import { verifyThresholdSync } from '../scripts/helpers/threshold-performance-fixture.mjs';
import { sha256 } from '../scripts/helpers/transcription-performance-fixture.mjs';

await mkdir('test-output', { recursive: true });
const directory = await mkdtemp(path.resolve('test-output/composition-engine-'));
const report = { date: new Date().toISOString(), status: 'running', scope: '60-second real backend composition of 16 cuts, 16 manually authored Korean captions and 16 audible effects plus muted/removed controls. This is engine/oracle verification, not app UI performance, real speech accuracy or human audio quality.', sourceHashes: {} };
for (const file of ['server/media.mjs', 'shared/timeline.mjs', 'server/effects.mjs', 'server/caption-rendering.mjs', 'server/caption-render-worker.mjs', 'scripts/helpers/composition-oracle.mjs', 'scripts/helpers/composition-performance-fixture.mjs', 'tests/composition-smoke.integration.mjs']) report.sourceHashes[file] = await sha256(file);
test('60-second Korean captions and effects pass independent decoded frame, audio, SRT and sync checks', async () => {
  try {
    const input = await compositionFixture(60, directory), media = await inspectMedia(input.source), effect = await inspectEffect(input.effectFile);
    assert.equal(media.fingerprint, input.media.fingerprint); assert.equal(effect.fingerprint, input.effectFingerprint);
    const analysis = await analyzeMedia(media, DEFAULT_SETTINGS, 1);
    assert.equal(analysis.cuts.length, 16);
    const expected = expectedComposition(media.duration, analysis.cuts, input.data);
    Object.assign(report, { input, analysis, expected });
    assert.equal(expected.captions.length, 16); assert.equal(expected.effects.length, 16);
    assert.deepEqual(expected.excludedEffects, [{ id: 'muted-control', reason: 'muted' }, { id: 'removed-control', reason: 'removed' }]);
    const options = { ...input.data, effectAssets: new Map([[effect.id, effect]]) };
    const output = await exportMedia(media, analysis.cuts, 1, directory, options);
    Object.assign(report, { output, outputSHA256: await sha256(output.path) });
    assert.equal(output.burnedCaptions, 16); assert.equal(output.audioMix.mixedClips, 16); assert.equal(output.verified, true);
    const srt = await exportCaptions(media, analysis.cuts, 1, input.data.transcript, directory);
    const srtEvidence = verifyCompositionSRT(await readFile(srt.path, 'utf8'), expected.captions);
    Object.assign(report, { srt, srtSHA256: await sha256(srt.path), srtEvidence });
    const videoEvidence = await verifyCompositionVideo(output.path, expected, directory);
    report.videoEvidence = videoEvidence;
    const audioEvidence = await verifyCompositionAudio(output.path, expected);
    report.audioEvidence = audioEvidence;
    const syncEvidence = await verifyThresholdSync(input, output.path, analysis.cuts, directory);
    assert.equal(await sha256(input.source), media.fingerprint); assert.equal(await sha256(input.effectFile), effect.fingerprint);
    Object.assign(report, { status: 'completed', input, analysis, expected, output, outputSHA256: await sha256(output.path), srt, srtSHA256: await sha256(srt.path), srtEvidence, videoEvidence, audioEvidence, syncEvidence, sourcePreserved: true, effectPreserved: true, visualReview: 'NOT_RUN' });
  } catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
});
test.after(async () => {
  await writeFile(path.join(directory, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, reportFile: path.join(directory, 'results.json') }));
});
