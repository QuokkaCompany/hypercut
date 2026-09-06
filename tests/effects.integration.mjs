import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, readdir, mkdir, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { createServer } from 'node:http';
import { writeTone, writeFlashVideo } from './helpers/effects-fixture.mjs';
import { inspectEffect, publicEffect, mixEffects, inspectMixedOutput } from '../server/effects.mjs';
import { inspectMedia, exportMedia } from '../server/media.mjs';
import { startServer } from '../server/app.mjs';
import { capture } from '../server/process.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
const dir = await mkdtemp(path.join(os.tmpdir(), 'hypercut-effects-')), reports = [];
const wav = await writeTone(path.join(dir, 'beep.wav')), source = await writeFlashVideo(path.join(dir, 'source.mp4'));
const asset = await inspectEffect(wav.file), media = await inspectMedia(source), registry = new Map([[asset.id, asset]]);
const cuts = [{ id: 'cut', start: 2, end: 4, enabled: true }];
const clip = (id, start, extra = {}) => ({ id, assetId: asset.id, start, offset: 0, duration: .5, gainDb: 0, muted: false, ...extra });
const effects = clips => ({ assets: [publicEffect(asset)], clips });
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const hashes = { source: await digest(source), effect: await digest(wav.file) };
async function pcm(file) { const target = path.join(dir, 'decoded.f32'); await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-vn', '-c:a', 'pcm_f32le', '-f', 'f32le', '-y', target]); const bytes = await readFile(target); return new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
function rms(samples, start, end, channel = 0, channels = 1) { let sum = 0, count = 0; for (let i = Math.round(start * 48000); i < Math.round(end * 48000); i++) { sum += samples[i * channels + channel] ** 2; count++; } return Math.sqrt(sum / count); }
function boundaries(samples, start, end) {
  let first, last;
  for (let i = Math.max(0, Math.round((start - .1) * 48000)); i < Math.min(samples.length, Math.round((end + .1) * 48000)); i++) if (Math.abs(samples[i]) > .005) { first ??= i / 48000; last = (i + 1) / 48000; }
  assert.ok(first !== undefined && Math.abs(first - start) <= 1 / 30, `onset ${first}, expected ${start}`);
  assert.ok(last !== undefined && Math.abs(last - end) <= 1 / 30, `end ${last}, expected ${end}`);
  return { expected: [start, end], observed: [first, last], amplitudeGate: .005, toleranceSeconds: 1 / 30 };
}

test('FX01/FX02: actual MP4 has fixed beep/flash sync, gain, duration, mute and cut restoration', async () => {
  const data = effects([clip('a', 4), clip('deleted', 3), clip('quiet', 5, { gainDb: -6.020599913 }), clip('muted', 6, { muted: true }), clip('end', 7.8, { duration: 2 })]);
  const output = await exportMedia(media, cuts, 1, dir, { effects: data, effectAssets: registry });
  const samples = await pcm(output.path), loud = rms(samples, 2.1, 2.4), quiet = rms(samples, 3.1, 3.4);
  const timing = [[2, 2.5], [3, 3.5], [5.8, 6]].map(([start, end]) => boundaries(samples, start, end));
  assert.ok(Math.abs(loud - .2 / Math.sqrt(2)) < .002); assert.ok(Math.abs(quiet / loud - .5) < .02);
  for (const [a, b] of [[0, 1.9], [2.6, 2.9], [3.6, 5.7]]) assert.ok(rms(samples, a, b) < .00005);
  assert.equal(output.duration, 6); assert.equal(output.audioMix.mixedClips, 3); assert.equal(output.audioMix.overloadedSamples, 0); assert.equal(output.audioMix.encodedOverloadedSamples, 0);
  const raw = path.join(dir, 'flash.rgb'); await capture('ffmpeg', ['-v', 'error', '-ss', '2.1', '-i', output.path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]); const pixels = await readFile(raw); assert.ok(pixels[(20 * 640 + 20) * 3] > 230);
  const restored = await exportMedia(media, [], 1, dir, { effects: data, effectAssets: registry }); const originalClock = await pcm(restored.path); assert.ok(rms(originalClock, 3.1, 3.4) > .13); assert.ok(rms(originalClock, 4.1, 4.4) > .13);
  reports.push({ case: 'FX01-FX02', outputSeconds: output.duration, timing, loudRMS: loud, quietRMS: quiet, gainRatio: quiet / loud, audioMix: output.audioMix, flashAndBeepSeconds: 2, restoredDeletedAnchor: 3, status: 'PASS' });
});
test('FX01: range preview keeps an earlier effect tail and uses the full edited clock', async () => {
  for (const preview of [true, false]) {
  const output = await exportMedia(media, cuts, 1, dir, { preview, range: { start: 4.5, end: 6 }, effects: effects([clip('tail', 1.5, { duration: 2 })]), effectAssets: registry });
  const samples = await pcm(output.path); assert.equal(output.duration, 1.5); assert.ok(rms(samples, .1, .9) > .13); assert.ok(rms(samples, 1.1, 1.4) < .00005);
  reports.push({ case: preview ? 'FX01-preview-tail' : 'FX01-clip-tail', originalAnchor: 1.5, previewSourceStart: 4.5, audiblePreviewSeconds: [0, 1], status: 'PASS' });
  }
});
test('FX01/FX02: VFR with source PTS +5 and a 44.1kHz effect keeps expected output placement', async () => {
  const vfr = path.join(dir, 'vfr.mp4'), shifted = path.join(dir, 'offset.mp4');
  await capture('ffmpeg', ['-v', 'error', '-i', source, '-vf', "select='if(lt(t,4),not(mod(n,2)),1)'", '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'copy', '-y', vfr]);
  await capture('ffmpeg', ['-v', 'error', '-i', vfr, '-map', '0', '-c', 'copy', '-output_ts_offset', '5', '-y', shifted]);
  const tone = await writeTone(path.join(dir, '44k.wav'), { rate: 44100 }), a = await inspectEffect(tone.file), m = await inspectMedia(shifted); assert.equal(m.origin, 5);
  const output = await exportMedia(m, cuts, 1, dir, { effects: { assets: [publicEffect(a)], clips: [clip('resample', 4.1, { assetId: a.id, offset: .1, duration: .4 })] }, effectAssets: new Map([[a.id, a]]) });
  const samples = await pcm(output.path); assert.ok(rms(samples, 2.15, 2.45) > .13); assert.ok(rms(samples, 0, 2) < .00005); assert.ok(rms(samples, 2.6, 5.9) < .00005);
  reports.push({ case: 'FX01-VFR-PTS-resample', sourcePTS: 5, sourceEffectRate: 44100, outputRate: 48000, timing: boundaries(samples, 2.1, 2.5), status: 'PASS' });
});
test('FX02: sample-level stereo mix preserves trim/gain/overlap and bounds memory to blocks', async () => {
  const stereo = await writeTone(path.join(dir, 'stereo.wav'), { seconds: 1, channels: 2 }); const a = await inspectEffect(stereo.file), work = path.join(dir, 'pcm-work'); await mkdir(work);
  const base = path.join(work, 'base.f32'); await writeFile(base, Buffer.alloc(48000 * 2 * 4));
  const clips = [0, 1].map(i => ({ id: `st${i}`, assetId: a.id, start: .25, offset: .125, duration: .5, gainDb: -6.020599913 }));
  const result = await mixEffects(base, clips, [publicEffect(a)], new Map([[a.id, a]]), { sampleRate: 48000, channels: 2 }, work);
  const bytes = await readFile(base);
  for (let frame = 0; frame < 48000; frame++) for (let ch = 0; ch < 2; ch++) {
    const expected = frame >= 12000 && frame < 36000 ? stereo.pcm.readInt16LE(((frame - 12000 + 6000) * 2 + ch) * 2) / 32768 : 0;
    assert.ok(Math.abs(bytes.readFloatLE((frame * 2 + ch) * 4) - expected) < 1e-7);
  }
  assert.equal(result.mixedClips, 2); reports.push({ case: 'FX02-exact-PCM', frames: 48000, channels: 2, maximumError: '<1e-7', status: 'PASS' });
});
test('FX02/FX03: clipping, missing/changed asset reject without final files; explicit mute can exclude a missing asset', async () => {
  const before = new Set(await readdir(dir));
  await assert.rejects(exportMedia(media, [], 1, dir, { effects: effects([clip('a', 1, { gainDb: 12 }), clip('b', 1, { gainDb: 12 })]), effectAssets: registry }), /0 dBFS/);
  assert.deepEqual(new Set(await readdir(dir)), before);
  await assert.rejects(exportMedia(media, [], 1, dir, { effects: effects([clip('a', 1)]), effectAssets: new Map() }), /다시 연결/);
  const changed = path.join(dir, 'changed.wav'); await copyFile(wav.file, changed); await writeFile(changed, Buffer.from('modified'));
  await assert.rejects(exportMedia(media, [], 1, dir, { effects: effects([clip('a', 1)]), effectAssets: new Map([[asset.id, { ...asset, path: changed }]]) }), /내용이 변경/);
  const out = await exportMedia(media, [], 1, dir, { effects: effects([clip('a', 1, { muted: true })]), effectAssets: new Map() }); assert.equal(out.audioMix.mixedClips, 0);
});
test('FX02: encoded overload is rejected by independently decoding the finished audio', async () => {
  const loud = path.join(dir, 'overload.m4a');
  await capture('ffmpeg', ['-v', 'error', '-i', wav.file, '-af', 'volume=10', '-c:a', 'aac', '-b:a', '192k', '-y', loud]);
  await assert.rejects(inspectMixedOutput(loud, { channels: 1 }), /AAC 출력 오디오가 0 dBFS/);
});
test('FX05: mixing cancellation settles under 5s, cleans work, preserves prior output and retries with captions', async () => {
  const safe = await exportMedia(media, [], 1, dir), hash = await digest(safe.path), before = new Set(await readdir(dir));
  const controller = new AbortController(); let reached = false, at;
  await assert.rejects(exportMedia(media, cuts, 1, dir, { effects: effects([clip('a', 4)]), effectAssets: registry, signal: controller.signal, progress: event => { if (event.stage === '효과음 음량 합성') { reached = true; at = performance.now(); controller.abort(); } } }), { name: 'AbortError' });
  const cancelMilliseconds = performance.now() - at; assert.ok(reached); assert.ok(cancelMilliseconds < 5000); assert.deepEqual(new Set(await readdir(dir)), before); assert.equal(await digest(safe.path), hash);
  const output = await exportMedia(media, cuts, 1, dir, { effects: effects([clip('a', 4)]), effectAssets: registry, transcript: { trackIndex: 1, channel: 0, language: 'ko', model: 'manual fixture', cues: [{ id: 'a', start: 4, end: 4.5, text: '효과음과 자막' }] }, captionStyle: { ...DEFAULT_CAPTION_STYLE, enabled: true } }); assert.equal(output.burnedCaptions, 1); assert.equal(output.audioMix.mixedClips, 1);
  reports.push({ case: 'FX05-cancel-retry-caption', cancelledDuringMix: true, cancelMilliseconds, priorOutputPreserved: true, status: 'PASS' });
});
test('FX03: authenticated browser audio upload hides paths, rejects video and renders a registered asset', async () => {
  const server = await startServer({ port: 0, dataDir: path.join(dir, 'api') });
  try {
    const { token } = await (await fetch(`${server.url}/api/config`)).json(), headers = { 'X-Hypercut-Token': token };
    assert.equal((await fetch(`${server.url}/api/effects`, { method: 'POST' })).status, 401);
    async function upload(file) { const body = new FormData(); body.append('audio', new Blob([await readFile(file)]), path.basename(file)); return fetch(`${server.url}/api/effects`, { method: 'POST', headers, body }); }
    const response = await upload(wav.file); assert.equal(response.status, 200); const saved = await response.json(); assert.equal(saved.id, asset.id); assert.equal(saved.path, undefined); assert.equal(saved.trackIndex, undefined);
    assert.equal((await upload(source)).status, 400);
    const m = await server.registerFile(source), request = await fetch(`${server.url}/api/jobs`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'export', mediaId: m.id, trackIndex: 1, cuts, effects: effects([clip('a', 4)]) }) }); const job = await request.json(); assert.equal(request.status, 202);
    let done; do { await new Promise(resolve => setTimeout(resolve, 30)); done = await (await fetch(`${server.url}/api/jobs/${job.id}`, { headers })).json(); } while (done.status === 'running'); assert.equal(done.status, 'completed'); assert.equal(done.result.audioMix.mixedClips, 1);
  } finally { await server.close(); }
});
test('FX03: local audio formats decode; disguised remote playlists are rejected before any network request', async () => {
  for (const [extension, codec] of [['mp3', 'libmp3lame'], ['m4a', 'aac'], ['flac', 'flac'], ['ogg', 'libopus'], ['aac', 'aac']]) {
    const file = path.join(dir, `format.${extension}`); await capture('ffmpeg', ['-v', 'error', '-i', wav.file, '-c:a', codec, '-y', file]); const a = await inspectEffect(file);
    const out = await exportMedia(media, cuts, 1, dir, { effects: { assets: [publicEffect(a)], clips: [clip('format', 4, { assetId: a.id })] }, effectAssets: new Map([[a.id, a]]) }); assert.equal(out.audioMix.mixedClips, 1);
  }
  let calls = 0;
  const remote = createServer((_req, res) => { calls++; res.end('not media'); }); await new Promise(resolve => remote.listen(0, '127.0.0.1', resolve));
  try {
    for (const extension of ['wav', 'm3u8']) {
      const disguised = path.join(dir, `playlist.${extension}`); await writeFile(disguised, `#EXTM3U\n#EXT-X-TARGETDURATION:3\n#EXTINF:3,\nhttp://127.0.0.1:${remote.address().port}/segment.aac\n#EXT-X-ENDLIST\n`);
      await assert.rejects(inspectEffect(disguised), extension === 'm3u8' ? /whitelist/ : /Invalid data|whitelist/); assert.equal(calls, 0);
    }
  } finally { await new Promise(resolve => remote.close(resolve)); }
  reports.push({ case: 'FX03-local-formats', formats: ['wav', 'mp3', 'm4a', 'flac', 'ogg', 'aac'], disguisedPlaylistRejected: true, nestedNetworkRequests: calls, status: 'PASS' });
});
test.after(async () => { assert.equal(await digest(source), hashes.source); assert.equal(await digest(wav.file), hashes.effect); await mkdir('test-output', { recursive: true }); await writeFile('test-output/effects-integration.json', JSON.stringify({ hashes, reports }, null, 2)); await rm(dir, { recursive: true, force: true }); });
