import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { speechFixture } from './helpers/speech-fixture.mjs';
import { inspectMedia, analyzeMedia, exportMedia } from './reference/server/media.mjs';
import { DEFAULT_SETTINGS, intervalDuration, keptIntervals } from '../shared/timeline.mjs';
import { createSpeechDetector } from './reference/server/vad.mjs';
import { capture } from './reference/server/process.mjs';
import { startServer } from './reference/server/app.mjs';
import { generateDemo } from '../scripts/fixtures.mjs';

for (const variant of [{ channels: 'mono', sampleRate: 48000 }, { channels: 'right', sampleRate: 48000 }, { channels: 'opposite', sampleRate: 44100, offset: 3 }]) test(`S03/S04: actual Silero preserves quiet Korean TTS and cuts long silence (${variant.channels})`, { timeout: 60000, skip: process.platform !== 'darwin' }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-speech-'));
  try {
    const fixture = await speechFixture(directory, variant), media = await inspectMedia(fixture.video), track = media.audioTracks[0].index;
    const plain = await analyzeMedia(media, DEFAULT_SETTINGS, track);
    assert.equal(keptIntervals(plain.cuts, media.duration).length, 0, 'fixture must be quieter than the dB threshold');
    const result = await analyzeMedia(media, DEFAULT_SETTINGS, track, { speechProtection: { enabled: true, threshold: 0.5 } });
    assert.ok(result.protection.intervals.length >= 2);
    assert.ok(result.cuts.some(cut => cut.start <= fixture.middleSilence.start + 0.5 && cut.end >= fixture.middleSilence.end - 0.5));
    assert.ok(intervalDuration(result.cuts) < intervalDuration(plain.cuts));
    // Independently generated source PCM is the oracle, not the VAD's intervals.
    const sourcePCM = await readFile(path.join(directory, 'speech.f32'));
    const count = sourcePCM.length / 4 / fixture.channels;
    let totalEnergy = 0, removedEnergy = 0, index = 0;
    for (let frame = 0; frame < count; frame++) {
      const time = frame / fixture.sampleRate;
      while (index < result.cuts.length && result.cuts[index].end <= time) index++;
      let energy = 0; for (let c = 0; c < fixture.channels; c++) energy += sourcePCM.readFloatLE((frame * fixture.channels + c) * 4) ** 2;
      totalEnergy += energy;
      if (result.cuts[index] && result.cuts[index].start <= time) removedEnergy += energy;
    }
    const energyRetention = 1 - removedEnergy / totalEnergy;
    assert.ok(energyRetention >= 0.999, `generated speech energy retained: ${energyRetention}`);
    const output = await exportMedia(media, result.cuts, track, directory);
    assert.equal(output.verified, true); assert.equal((await inspectMedia(fixture.video)).fingerprint, media.fingerprint);
    const decoded = path.join(directory, 'output.f32');
    await capture('ffmpeg', ['-v', 'error', '-i', output.path, '-map', '0:a:0', '-f', 'f32le', '-y', decoded]);
    const audio = await readFile(decoded); let peak = 0; for (let i = 0; i < audio.length; i += 4) peak = Math.max(peak, Math.abs(audio.readFloatLE(i)));
    assert.ok(peak < 0.01, 'analysis gain must not change exported audio volume');
    console.log(JSON.stringify({ variant, sourceSHA256: media.fingerprint, pcmSHA256: fixture.pcmSHA256, sourceSeconds: media.duration, outputSeconds: output.duration, speechIntervals: result.protection.intervals, energyRetention, outputPeak: peak, analysisGain: result.protection.analysisGain, sourceUnchanged: true, model: result.protection.model }));
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('S06: missing/corrupt model fails before inference; actual session can cancel and restart', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-speech-error-'));
  const options = { channels: 2, threshold: 0.5, duration: 1 };
  try {
    await assert.rejects(createSpeechDetector({ ...options, modelPath: path.join(directory, 'missing') }), /찾을 수 없/);
    const corrupt = path.join(directory, 'corrupt'); await writeFile(corrupt, 'bad model');
    await assert.rejects(createSpeechDetector({ ...options, modelPath: corrupt }), /손상/);
    const controller = new AbortController(), detector = await createSpeechDetector({ ...options, signal: controller.signal });
    try { await detector.push(new Float32Array(1024)); controller.abort(); await assert.rejects(detector.push(new Float32Array(1024)), { name: 'AbortError' }); }
    finally { await detector.close(); }
    const next = await createSpeechDetector(options);
    try { await next.push(new Float32Array(123 * 2)); assert.deepEqual(await next.finish(), []); }
    finally { await next.close(); }
    assert.equal(process.env.ORT_DISABLE_TELEMETRY, '1');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('S06: cancels an active VAD API job after inference progress and retries', { timeout: 30000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-vad-cancel-')); let server;
  try {
    const sample = await generateDemo(path.join(directory, 'short.mp4')), long = path.join(directory, 'long.mp4');
    await capture('ffmpeg', ['-v', 'error', '-nostdin', '-stream_loop', '11', '-i', sample, '-t', '180', '-c', 'copy', '-y', long]);
    server = await startServer({ port: 0, dataDir: directory });
    const media = await server.registerFile(long), short = await server.registerFile(sample), { token } = await (await fetch(`${server.url}/api/config`)).json();
    const call = async (route, body, method = 'POST') => (await fetch(`${server.url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: body ? JSON.stringify(body) : undefined })).json();
    const body = { type: 'analyze', mediaId: media.id, settings: DEFAULT_SETTINGS, trackIndex: media.audioTracks[0].index, speechProtection: { enabled: true, threshold: 0.5 } };
    const started = await call('/jobs', body); let seen;
    for (let i = 0; i < 1500; i++) {
      const job = await call(`/jobs/${started.id}`, undefined, 'GET');
      if (job.status === 'running' && job.stage === '로컬 말소리 구간 확인') { seen = job; break; }
      if (job.status !== 'running') throw new Error(`VAD job ended before cancellation: ${job.status}`);
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.ok(seen, 'must observe actual model inference progress');
    const begin = performance.now(); await call(`/jobs/${started.id}`, undefined, 'DELETE');
    const cancellationMs = performance.now() - begin, cancelled = await call(`/jobs/${started.id}`, undefined, 'GET');
    assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined); assert.ok(cancellationMs < 5000);
    const retry = await call('/jobs', { ...body, mediaId: short.id }); let completed;
    for (let i = 0; i < 500; i++) { completed = await call(`/jobs/${retry.id}`, undefined, 'GET'); if (completed.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(completed.status, 'completed'); assert.equal(completed.result.protection.model, 'silero-vad-6.2.1');
    console.log(JSON.stringify({ cancellationMs, actualInferenceProgress: seen.progress, oldJobHasNoResult: true, retry: 'PASS' }));
  } finally { await server?.close(); await rm(directory, { recursive: true, force: true }); }
});
