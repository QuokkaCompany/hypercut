import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/app.mjs';
import { generateDemo } from '../scripts/fixtures.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';

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
  assert.equal((await call('/jobs', { ...base, type: 'analyze', settings: DEFAULT_SETTINGS, speechProtection: { enabled: true, threshold: 2 } })).status, 400);
  assert.equal((await call('/jobs', { ...base, type: 'analyze', settings: DEFAULT_SETTINGS, speechProtection: { enabled: 'true', threshold: 0.5 } })).status, 400);
  assert.equal((await call('/jobs', { ...base, trackIndex: 999, type: 'analyze', settings: DEFAULT_SETTINGS })).status, 400);
  assert.equal((await call('/jobs', { ...base, type: 'export', cuts: [{ start: 0, end: 100, enabled: true }] })).status, 400);
  assert.equal((await call('/jobs', { ...base, type: 'exec', command: 'anything' })).status, 400);
});
test('C05/C09 API: style images require registered media and valid plain text, and recover after a glyph error', async () => {
  const body = { mediaId: media.id, text: '한글 <b>{\\N}', captionStyle: { ...DEFAULT_CAPTION_STYLE, enabled: true } };
  const unauthorized = await fetch(`${server.url}/api/captions/style-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal(unauthorized.status, 401);
  for (const invalid of [{ ...body, mediaId: sample }, { ...body, text: '' }, { ...body, text: '가'.repeat(2001) }, { ...body, captionStyle: { ...body.captionStyle, sizePercent: 200 } }, { ...body, text: '😀' }]) assert.equal((await call('/captions/style-preview', invalid)).status, 400);
  const response = await call('/captions/style-preview', body); assert.equal(response.status, 200);
  const result = await response.json(); assert.match(result.image, /^data:image\/png;base64,/); assert.equal(result.path, undefined); assert.ok(result.layout.lines >= 1);
  const job = { type: 'export', mediaId: media.id, trackIndex: 1, cuts: [], captionStyle: body.captionStyle };
  assert.equal((await call('/jobs', job)).status, 400);
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
test('E01/E06: cancellation arriving before job creation prevents a late start', async () => {
  const requestId = randomUUID();
  assert.equal((await call(`/jobs/${requestId}`, undefined, 'DELETE')).status, 200);
  const created = await (await call('/jobs', { requestId, type: 'analyze', mediaId: media.id, trackIndex: 1, settings: DEFAULT_SETTINGS })).json();
  assert.equal(created.id, requestId); assert.equal(created.status, 'cancelled');
  assert.equal((await terminal(requestId)).result, undefined);
  assert.equal((await call('/jobs', { requestId, type: 'analyze', mediaId: media.id, trackIndex: 1, settings: DEFAULT_SETTINGS })).status, 400);
});
test('E01: accurate preview cancellation settles before acknowledging and permits retry', async () => {
  const requestId = randomUUID(), body = { requestId, type: 'preview', mediaId: media.id, trackIndex: 1, cuts: [] };
  assert.equal((await call('/jobs', body)).status, 202);
  const start = performance.now();
  const acknowledgement = await (await call(`/jobs/${requestId}`, undefined, 'DELETE')).json();
  assert.equal(acknowledgement.cancelled, true); assert.ok(performance.now() - start < 5000);
  const cancelled = await terminal(requestId); assert.equal(cancelled.status, 'cancelled'); assert.equal(cancelled.result, undefined);
  const next = await (await call('/jobs', { ...body, requestId: randomUUID() })).json();
  const completed = await terminal(next.id); assert.equal(completed.status, 'completed'); assert.equal(completed.result.duration, 16);
});

test('M06: preview range is validated, returned in source time, and explicit range exports create clips', async () => {
  const body = { type: 'preview', mediaId: media.id, trackIndex: 1, cuts: [{ start: 3, end: 5, enabled: true }] };
  for (const range of [null, { start: -1, end: 4 }, { start: 4, end: 3 }, { start: 3, end: 17 }]) assert.equal((await call('/jobs', { ...body, range })).status, 400);
  const clip = await (await call('/jobs', { ...body, type: 'export', range: { start: 2, end: 6 } })).json();
  const saved = await terminal(clip.id); assert.equal(saved.status, 'completed'); assert.equal(saved.result.duration, 2); assert.match(saved.result.name, /clip\.mp4$/);
  const started = await (await call('/jobs', { ...body, range: { start: 2, end: 6 } })).json();
  const completed = await terminal(started.id);
  assert.equal(completed.status, 'completed'); assert.equal(completed.result.duration, 2);
  assert.deepEqual(completed.result.sourceRange, { start: 2, end: 6 });
  assert.deepEqual(completed.result.kept, [{ start: 2, end: 3 }, { start: 5, end: 6 }]);
  assert.equal(completed.result.path, undefined);
  const removed = await (await call('/jobs', { ...body, range: { start: 3.5, end: 4.5 } })).json();
  const failed = await terminal(removed.id); assert.equal(failed.status, 'failed'); assert.match(failed.error, /남아 있는 구간/);
});
