import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile, writeFile, readdir, copyFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { inspectMedia, transcriptionAudio } from './reference/server/media.mjs';
import { transcribeMedia, transcriptionStatus, transcriptionRuntime, TRANSCRIPTION_MODEL } from './reference/server/transcription.mjs';
import { startServer } from './reference/server/app.mjs';
import { speechFixture } from './helpers/speech-fixture.mjs';
const reports = [];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('T01/T03: actual local Whisper decodes quiet Korean, selected stereo channels and offset source timestamps', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-stt-real-'));
  try {
    for (const options of [{ channels: 'mono' }, { channels: 'right' }, { channels: 'opposite', sampleRate: 44100, offset: 3 }]) {
      const fixture = await speechFixture(path.join(directory, options.channels), options);
      const before = hash(await readFile(fixture.video)), media = await inspectMedia(fixture.video);
      const started = performance.now(), channel = options.channels === 'mono' ? 0 : 1;
      const transcript = await transcribeMedia(media, media.audioTracks[0].index, { channel, language: 'ko' }, directory);
      assert.ok(transcript.cues.length > 0); assert.match(transcript.cues.map(x => x.text).join(''), /작은 목소리/);
      assert.ok(transcript.cues.every(cue => cue.start >= 0 && cue.end <= media.duration));
      assert.ok(transcript.cues[0].start < 3, 'source PTS offset must not shift captions');
      assert.equal(hash(await readFile(fixture.video)), before);
      const wav = path.join(directory, `${options.channels}.wav`); await transcriptionAudio(media, media.audioTracks[0].index, channel, wav);
      const bytes = await readFile(wav); assert.equal(bytes.subarray(0, 4).toString(), 'RIFF');
      reports.push({ input: options, engine: TRANSCRIPTION_MODEL, seconds: (performance.now() - started) / 1000, transcript, scope: 'Actual inference and channel/clock integration; TTS does not establish human recording quality' });
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
  await mkdir('test-output', { recursive: true }); await writeFile('test-output/transcription-results.json', JSON.stringify(reports, null, 2));
});

test('T04: cancelling an actual inference preserves the source and permits retry', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-stt-cancel-'));
  try {
    const fixture = await speechFixture(directory), media = await inspectMedia(fixture.video), controller = new AbortController();
    let duringInference = false, cancelAt;
    await assert.rejects(transcribeMedia(media, 1, { channel: 0, language: 'ko' }, directory, { signal: controller.signal, progress: value => { if (value.progress === .15) setTimeout(() => { duringInference = true; cancelAt = performance.now(); controller.abort(); }, 20); } }), { name: 'AbortError' });
    assert.ok(duringInference); assert.ok(performance.now() - cancelAt < 5000);
    assert.equal((await readdir(directory)).some(x => x.endsWith('.transcription')), false);
    assert.ok((await transcribeMedia(media, 1, { channel: 0, language: 'ko' }, directory)).cues.length);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('T05: absent and corrupted real-size models fail explicitly without an inference fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-stt-corrupt-'));
  try {
    assert.equal((await transcriptionStatus(directory)).ready, false);
    await copyFile(path.join(transcriptionRuntime(), 'whisper-cli'), path.join(directory, 'whisper-cli'));
    await copyFile(path.join(transcriptionRuntime(), TRANSCRIPTION_MODEL.file), path.join(directory, TRANSCRIPTION_MODEL.file), constants.COPYFILE_FICLONE);
    const handle = await open(path.join(directory, TRANSCRIPTION_MODEL.file), 'r+'); try { await handle.write(Buffer.from([0]), 0, 1, 0); } finally { await handle.close(); }
    const media = { duration: 12, audioTracks: [{ index: 1, channels: 1 }] };
    await assert.rejects(transcribeMedia(media, 1, { channel: 0, language: 'ko' }, directory, { runtime: directory }), /손상/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('T06/C01/C05: authenticated API runs real transcription and exports frame-consistent SRT', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-stt-api-')); let server;
  try {
    const fixture = await speechFixture(directory); server = await startServer({ port: 0, dataDir: path.join(directory, 'app') });
    const media = await server.registerFile(fixture.video), config = await (await fetch(server.url + '/api/config')).json();
    const headers = { 'Content-Type': 'application/json', 'X-Hypercut-Token': config.token };
    const post = body => fetch(server.url + '/api/jobs', { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal((await fetch(server.url + '/api/transcription/status')).status, 401);
    assert.equal((await post({ type: 'transcribe', mediaId: media.id, trackIndex: 1, transcription: { channel: 2, language: 'ko' } })).status, 400);
    async function complete(body) { const response = await post(body); assert.equal(response.status, 202); const { id } = await response.json(); for (;;) { const job = await (await fetch(server.url + '/api/jobs/' + id, { headers })).json(); if (job.status !== 'running') { assert.equal(job.status, 'completed', job.error); return job.result; } await new Promise(resolve => setTimeout(resolve, 50)); } }
    const transcript = await complete({ type: 'transcribe', requestId: randomUUID(), mediaId: media.id, trackIndex: 1, transcription: { channel: 0, language: 'ko' } }); assert.ok(transcript.cues.length);
    transcript.cues = [{ id: 'caption', start: 5, end: 6.2, text: '확인한 한글' }];
    const output = await complete({ type: 'captions', requestId: randomUUID(), mediaId: media.id, trackIndex: 1, cuts: [{ id: 'cut', start: 2, end: 4, enabled: true }], transcript });
    assert.equal(output.path, undefined); assert.equal(output.mime, 'application/x-subrip');
    const response = await fetch(server.url + '/api/exports/' + output.id, { headers }); assert.match(response.headers.get('Content-Type'), /application\/x-subrip/);
    assert.equal(await response.text(), '1\n00:00:03,000 --> 00:00:04,200\n확인한 한글\n');
  } finally { await server?.close(); await rm(directory, { recursive: true, force: true }); }
});
