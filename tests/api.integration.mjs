import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { generateDemo } from '../scripts/fixtures.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { request as httpRequest } from 'node:http';

let server, directory, media, token, sample;
const call = (route, body, method = 'POST', extraHeaders = {}) => fetch(`${server.url}/api${route}`, { method, headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token, ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
async function terminal(id) {
  for (let attempt = 0; attempt < 100; attempt++) { const job = await (await call(`/jobs/${id}`, undefined, 'GET')).json(); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 50)); }
  throw new Error('Job did not settle within 5 seconds');
}
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-api-'));
  sample = await generateDemo(path.join(directory, "원본 ' $(name).mp4"));
  server = await startServer({ port: 0, dataDir: path.join(directory, '.hidden') });
  token = (await (await fetch(`${server.url}/api/config`)).json()).token;
  media = await server.registerFile(sample);
});
after(async () => { await server?.close(); await rm(directory, { recursive: true, force: true }); });

test('API: rejects unauthenticated writes, cross-site requests and DNS rebinding hosts', async () => {
  const unauthorized = await fetch(`${server.url}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(unauthorized.status, 401);
  assert.equal((await call('/jobs', {}, 'POST', { Origin: 'https://example.com' })).status, 403);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(`${server.url}/api/config`, { headers: { Host: 'untrusted.invalid' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(hostileHostStatus, 403);
});
test('U04: browser upload preserves Unicode name and source fingerprint', async () => {
  const form = new FormData(); form.append('video', new Blob([await readFile(sample)], { type: 'video/mp4' }), "한글 ' 영상 $(name).mp4");
  const response = await fetch(`${server.url}/api/media`, { method: 'POST', headers: { 'X-Hypercut-Token': token }, body: form });
  assert.equal(response.status, 200);
  const uploaded = await response.json();
  assert.equal(uploaded.name, "한글 ' 영상 $(name).mp4"); assert.equal(uploaded.fingerprint, media.fingerprint);
  assert.equal(uploaded.path, undefined);
  const range = await fetch(`${server.url}/api/media/${uploaded.id}/file?token=${token}`, { headers: { Range: 'bytes=0-15' } });
  assert.equal(range.status, 206); assert.match(range.headers.get('content-range'), /^bytes 0-15\//);
  assert.deepEqual(Buffer.from(await range.arrayBuffer()), (await readFile(sample)).subarray(0, 16));
});
test('API: rejects invalid settings, unknown audio and malformed export cuts', async () => {
  const base = { mediaId: media.id, trackIndex: media.audioTracks[0].index };
  assert.equal((await call('/jobs', { ...base, type: 'analyze', settings: { ...DEFAULT_SETTINGS, thresholdDb: 1 } })).status, 400);
  assert.equal((await call('/jobs', { ...base, trackIndex: 999, type: 'analyze', settings: DEFAULT_SETTINGS })).status, 400);
  assert.equal((await call('/jobs', { ...base, type: 'export', cuts: [{ start: 0, end: 100, enabled: true }] })).status, 400);
  assert.equal((await call('/jobs', { ...base, type: 'exec', command: 'anything' })).status, 400);
});
test('E01/E06: cancel active analysis, settle, and run another without stale completion', async () => {
  const body = { type: 'analyze', mediaId: media.id, trackIndex: media.audioTracks[0].index, settings: DEFAULT_SETTINGS };
  const initial = await (await call('/jobs', body)).json();
  await call(`/jobs/${initial.id}`, undefined, 'DELETE');
  const cancelled = await terminal(initial.id);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined);
  const second = await (await call('/jobs', body)).json();
  const finished = await terminal(second.id);
  assert.equal(finished.status, 'completed'); assert.equal(finished.result.cuts.length, 5);
  assert.equal(finished.task, undefined); assert.equal(finished.controller, undefined);
  assert.equal((await terminal(initial.id)).status, 'cancelled');
});
test('E01: cancelled render produces no successful export and can retry', async () => {
  const body = { type: 'export', mediaId: media.id, trackIndex: media.audioTracks[0].index, cuts: [{ start: 3, end: 5, enabled: true }] };
  const initial = await (await call('/jobs', body)).json();
  await call(`/jobs/${initial.id}`, undefined, 'DELETE');
  const cancelled = await terminal(initial.id);
  assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined);
  const next = await (await call('/jobs', body)).json();
  const output = await terminal(next.id);
  assert.equal(output.status, 'completed'); assert.equal(output.result.duration, 14);
  const download = await fetch(`${server.url}/api/exports/${output.result.id}?token=${token}&download=1`);
  assert.equal(download.status, 200); assert.match(download.headers.get('content-disposition'), /attachment/);
  assert.ok((await download.arrayBuffer()).byteLength > 1000);
});
