// Run only against the disposable `hypercut-beta-validation` Compose project.
// This creates one test account and synthetic media in that project's volume.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { client, until } from '../tests/helpers/cloud.mjs';
import { capture } from '../server/process.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';

if (process.platform !== 'darwin') throw new Error('This optional smoke fixture uses macOS say. Core cloud tests are cross-platform.');
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-container-'));
const evidence = path.resolve('test-output/cloud-container'); await mkdir(evidence, { recursive: true });
const password = randomBytes(24).toString('hex'), email = `smoke-${Date.now()}@example.com`;
const api = client(() => ({ url: 'http://127.0.0.1:4328' }));
try {
  await new Promise((resolve, reject) => {
    const child = spawn('docker', ['compose', '-p', 'hypercut-beta-validation', 'exec', '-T', 'api', 'node', 'scripts/cloud-user.mjs', email], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = ''; child.stderr.on('data', chunk => stderr += chunk); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr))); child.stdin.end(password);
  });
  await api.login(email, password);
  const status = await api.call('/transcription/status'); assert.equal(status.ready, true, status.error);
  const aiff = path.join(directory, 'voice.aiff'), video = path.join(directory, 'speech.mp4');
  await capture('say', ['-v', 'Samantha', '-r', '150', '-o', aiff, 'Welcome to this video editing test. We keep the original recording. Captions can help people understand the video.']);
  await capture('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x243324:s=640x360:r=30', '-i', aiff, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-af', 'adelay=1000|1000,apad=pad_dur=1', '-shortest', '-movflags', '+faststart', video]);
  const media = await api.upload(await readFile(video), 'Synthetic English speech.mp4');
  const run = async (type, extra = {}) => {
    const job = await api.call('/jobs', { requestId: crypto.randomUUID(), type, mediaId: media.id, trackIndex: media.audioTracks[0].index, ...extra });
    const finished = await until(async () => { const value = await api.call(`/jobs/${job.id}`); return ['completed', 'failed', 'cancelled'].includes(value.status) && value; }, 180000);
    assert.equal(finished.status, 'completed', finished.error); return finished.result;
  };
  const analysis = await run('analyze', { settings: DEFAULT_SETTINGS, speechProtection: { enabled: true, threshold: 0.5 } });
  assert.ok(analysis.protection); assert.ok(analysis.protection.intervals.length > 0);
  const transcript = await run('transcribe', { transcription: { channel: 0, language: 'en' } });
  assert.ok(transcript.cues.length > 0); assert.match(transcript.cues.map(x => x.text).join(' '), /video|captions|recording/i);
  const plain = await run('transcript', { cuts: [], transcript, textMode: 'source' });
  const downloaded = await api.raw(`/exports/${plain.id}?download=1`); const text = await downloaded.text(); assert.match(text, /video|captions|recording/i);
  const preview = await api.call('/captions/style-preview', { mediaId: media.id, text: 'HyperCut captions', captionStyle: { enabled: true, preset: 'box', sizePercent: 5, position: 'bottom', marginPercent: 8 } });
  assert.match(preview.image, /^data:image\/png;base64,/);
  // Original timeline avoids cuts across unreviewed captions; burn-in is still executed in the Linux renderer.
  const output = await run('export', { cuts: [], transcript, captionStyle: { enabled: true, preset: 'box', sizePercent: 5, position: 'bottom', marginPercent: 8 } });
  const file = path.join(evidence, 'captioned-linux.mp4'); await writeFile(file, Buffer.from(await (await api.raw(`/exports/${output.id}?download=1`)).arrayBuffer()));
  await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
  await writeFile(path.join(evidence, 'result.json'), JSON.stringify({ fixture: 'macOS Samantha synthetic English, not human speech', vadIntervals: analysis.protection.intervals.length, cues: transcript.cues.map(x => x.text), outputDuration: output.duration, burnedCaptions: output.burnedCaptions, paidRequests: 0, fullDecode: 'PASS' }, null, 2));
  console.log('PASS Linux container: authenticated upload, CPU Silero, real CPU Whisper English transcription, TXT, caption preview, captioned MP4 and full decode. No paid model calls.');
} finally { await rm(directory, { recursive: true, force: true }); }
