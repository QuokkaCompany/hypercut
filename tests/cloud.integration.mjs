import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createUser, digest } from '../server/cloud/store.mjs';
import { CHUNK_BYTES } from '../server/cloud/uploads.mjs';
import { generateDemo, pcmWav } from '../scripts/fixtures.mjs';
import { capture } from '../server/process.mjs';
import { DEFAULT_SETTINGS, makeProject } from '../shared/timeline.mjs';
import { startAPI, client, until, launchWorker } from './helpers/cloud.mjs';

let directory, server, source, media, project, worker;
const alice = client(() => server), bob = client(() => server);
const jobInput = overrides => ({ requestId: randomUUID(), type: 'analyze', mediaId: media.id, trackIndex: media.audioTracks[0].index, settings: DEFAULT_SETTINGS, ...overrides });
const terminal = id => until(async () => { const job = await alice.call(`/jobs/${id}`); return ['completed', 'failed', 'cancelled'].includes(job.status) && job; });
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cloud-'));
  source = await readFile(await generateDemo(path.join(directory, 'sample.mp4')));
  server = await startAPI(path.join(directory, 'data'));
  await createUser(server.store, 'alice@example.com', 'a-long-test-password'); await createUser(server.store, 'bob@example.com', 'a-long-test-password');
  await alice.login('alice@example.com'); await bob.login('bob@example.com');
});
after(async () => { await worker?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); });

test('cloud auth: cookie required, origin/CSRF/host checks, session isolation and invalid login', async () => {
  assert.equal((await fetch(`${server.url}/api/config`)).status, 401);
  assert.equal((await alice.raw('/projects', {}, 'POST', { 'X-Hypercut-Token': '' })).status, 403);
  assert.equal((await alice.raw('/config', undefined, 'GET', { Origin: 'https://evil.invalid' })).status, 403);
  const hostileHost = await new Promise((resolve, reject) => { const req = httpRequest(`${server.url}/api/runtime`, { headers: { Host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.on('error', reject); req.end(); });
  assert.equal(hostileHost, 403);
  assert.equal((await alice.raw('/auth/login', { email: 'alice@example.com', password: 'wrong' })).status, 401);
  assert.equal((await bob.call('/projects')).length, 0);
});
test('resumable upload survives API restart, rejects wrong hashes/offsets and commits exactly once', async () => {
  // Padding after the MP4 moov/mdat exercises multiple chunks without changing the decoded fixture.
  const bytes = Buffer.concat([source, Buffer.alloc(CHUNK_BYTES + 1)]);
  const state = await alice.call('/uploads', { name: '다국어 source.mp4', size: bytes.length });
  const first = bytes.subarray(0, CHUNK_BYTES);
  assert.equal((await bob.raw(`/uploads/${state.id}`)).status, 404);
  assert.equal((await bob.raw(`/uploads/${state.id}/chunks/0`, first, 'PUT', { 'X-Content-SHA256': digest(first) })).status, 404);
  assert.equal((await alice.raw(`/uploads/${state.id}/chunks/0`, first, 'PUT', { 'X-Content-SHA256': '0'.repeat(64) })).status, 400);
  await alice.call(`/uploads/${state.id}/chunks/0`, first, 'PUT', { 'X-Content-SHA256': digest(first) });
  await server.close(); server = await startAPI(path.join(directory, 'data'));
  assert.equal((await alice.call(`/uploads/${state.id}`)).offset, CHUNK_BYTES);
  assert.equal((await alice.call(`/uploads/${state.id}/chunks/0`, first, 'PUT', { 'X-Content-SHA256': digest(first) })).offset, CHUNK_BYTES);
  const altered = Buffer.from(first); altered[0] ^= 1;
  assert.equal((await alice.raw(`/uploads/${state.id}/chunks/0`, altered, 'PUT', { 'X-Content-SHA256': digest(altered) })).status, 409);
  assert.equal((await alice.raw(`/uploads/${state.id}/complete`, {})).status, 409);
  for (let offset = CHUNK_BYTES; offset < bytes.length; offset += CHUNK_BYTES) { const chunk = bytes.subarray(offset, offset + CHUNK_BYTES); await alice.call(`/uploads/${state.id}/chunks/${offset}`, chunk, 'PUT', { 'X-Content-SHA256': digest(chunk) }); }
  media = await alice.call(`/uploads/${state.id}/complete`, {});
  assert.equal(media.fingerprint, digest(bytes)); assert.equal(media.path, undefined);
  assert.equal((await alice.call(`/uploads/${state.id}/complete`, {})).id, media.id);
  const response = await alice.raw(`/media/${media.id}/file`, undefined, 'GET', { Range: 'bytes=0-15' });
  assert.equal(response.status, 206); assert.deepEqual(Buffer.from(await response.arrayBuffer()), source.subarray(0, 16));
});
test('projects are portable, owner scoped and revision guarded across API restart', async () => {
  const data = makeProject(media, DEFAULT_SETTINGS, media.audioTracks[0].index, []);
  project = await alice.call('/projects', { name: 'First project', mediaId: media.id, data });
  assert.equal(project.version, 1);
  for (const route of [`/media/${media.id}`, `/media/${media.id}/file`, `/projects/${project.id}`]) assert.equal((await bob.raw(route)).status, 404);
  assert.equal((await bob.raw(`/projects/${project.id}`, { ...project, version: 1 }, 'PUT')).status, 404);
  assert.equal((await bob.raw('/projects', { name: 'Stolen', mediaId: media.id, data })).status, 404);
  assert.equal((await alice.raw(`/media/${media.id}`, undefined, 'DELETE')).status, 409);
  project = await alice.call(`/projects/${project.id}`, { ...project, data: { ...data, glossary: 'HyperCut' } }, 'PUT');
  assert.equal(project.version, 2);
  assert.equal((await alice.raw(`/projects/${project.id}`, { ...project, version: 1 }, 'PUT')).status, 409);
  await server.close(); server = await startAPI(path.join(directory, 'data'));
  assert.equal((await alice.call(`/projects/${project.id}`)).data.glossary, 'HyperCut');
});
test('queue persists without a worker and request IDs are idempotent and owner scoped', async () => {
  const input = jobInput({ projectId: project.id, baseVersion: project.version });
  const queued = await alice.call('/jobs', input);
  assert.equal(queued.status, 'queued'); assert.equal((await alice.call('/jobs', input)).id, queued.id);
  assert.equal((await alice.call('/jobs', Object.fromEntries(Object.entries(input).reverse()))).id, queued.id);
  assert.equal((await alice.raw('/jobs', { ...input, settings: { ...DEFAULT_SETTINGS, thresholdDb: -42 } })).status, 409);
  assert.equal((await bob.raw(`/jobs/${queued.id}`)).status, 404);
  assert.equal((await bob.raw(`/jobs/${queued.id}`, undefined, 'DELETE')).status, 404);
  await server.close(); server = await startAPI(path.join(directory, 'data'));
  assert.equal((await alice.call(`/jobs/${queued.id}`)).status, 'queued');
  worker = launchWorker(path.join(directory, 'data'));
  const result = await terminal(queued.id);
  assert.equal(result.status, 'completed', result.error); assert.equal(result.result.cuts.length, 5); assert.equal(result.input, undefined);
  project = await alice.call(`/jobs/${queued.id}/apply`, {});
  assert.equal(project.data.cuts.length, 5); assert.equal(project.version, 3);
  assert.equal((await alice.call(`/jobs/${queued.id}/apply`, {})).version, 3);
});
test('stale completed analysis never overwrites newer edits', async () => {
  const job = await alice.call('/jobs', jobInput({ projectId: project.id, baseVersion: project.version }));
  await terminal(job.id);
  project = await alice.call(`/projects/${project.id}`, { ...project, data: { ...project.data, glossary: 'Newer edit' } }, 'PUT');
  assert.equal((await alice.raw(`/jobs/${job.id}/apply`, {})).status, 409);
  assert.equal((await alice.call(`/projects/${project.id}`)).data.glossary, 'Newer edit');
});
test('real worker exports a playable edited MP4, preserves source and enforces export ownership', async () => {
  const job = await alice.call('/jobs', jobInput({ type: 'export', cuts: project.data.cuts }));
  const result = await terminal(job.id); assert.equal(result.status, 'completed', result.error); assert.equal(result.result.path, undefined);
  assert.ok(result.result.duration > 9 && result.result.duration < 9.1);
  assert.equal((await bob.raw(`/exports/${result.result.id}`)).status, 404);
  assert.equal((await bob.raw(`/exports/${result.result.id}`, undefined, 'DELETE')).status, 404);
  const downloaded = await alice.raw(`/exports/${result.result.id}?download=1`); assert.equal(downloaded.status, 200);
  const output = path.join(directory, 'edited.mp4'); await writeFile(output, Buffer.from(await downloaded.arrayBuffer()));
  await capture('ffmpeg', ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
  const registered = server.store.need('media', media.id, server.store.all('media')[0].owner);
  assert.equal(digest(await readFile(registered.path)), media.fingerprint);
});
test('cancel before submission, queued cancellation and running cancellation have durable terminal states', async () => {
  await worker.close(); worker = null;
  const input = jobInput(); await alice.call(`/jobs/${input.requestId}`, undefined, 'DELETE');
  assert.equal((await alice.call('/jobs', input)).status, 'cancelled');
  const queued = await alice.call('/jobs', jobInput()); await alice.call(`/jobs/${queued.id}`, undefined, 'DELETE');
  assert.equal((await terminal(queued.id)).status, 'cancelled');
  const running = await alice.call('/jobs', jobInput({ type: 'export', cuts: [] }));
  worker = launchWorker(path.join(directory, 'data'));
  await until(async () => (await alice.call(`/jobs/${running.id}`)).status === 'running');
  await alice.call(`/jobs/${running.id}`, undefined, 'DELETE');
  assert.equal((await terminal(running.id)).status, 'cancelled');
});
test('worker crash fails interrupted work, releases reservation and permits an explicit retry', async () => {
  const running = await alice.call('/jobs', jobInput({ type: 'export', cuts: [] }));
  await until(async () => (await alice.call(`/jobs/${running.id}`)).status === 'running');
  await worker.close('SIGKILL'); worker = launchWorker(path.join(directory, 'data'));
  const failed = await terminal(running.id); assert.equal(failed.status, 'failed'); assert.match(failed.error, /interrupted/i);
  const retry = await alice.call('/jobs', jobInput()); assert.equal((await terminal(retry.id)).status, 'completed');
});
test('cloud AI is session scoped; local operator integrations are unreachable and keys do not persist', async () => {
  assert.equal((await alice.raw('/ai/connection', { provider: 'ollama', model: 'local' })).status, 400);
  assert.equal((await alice.raw('/ai/connection', { provider: 'claude_cli', model: 'sonnet' })).status, 400);
  assert.equal((await alice.raw('/ai/claude/status')).status, 404);
  await alice.call('/ai/connection', { provider: 'openai', model: 'test-model', apiKey: 'fake-test-key-not-a-secret' });
  assert.equal((await alice.call('/ai/connection')).connected, true); assert.equal((await bob.call('/ai/connection')).connected, false);
  const otherSession = client(() => server); await otherSession.login('alice@example.com'); assert.equal((await otherSession.call('/ai/connection')).connected, false);
  assert.equal(JSON.stringify(server.store.all('project')).includes('fake-test-key'), false);
  await alice.call('/auth/logout', {}); assert.equal((await alice.raw('/config')).status, 401);
  await alice.login('alice@example.com'); assert.equal((await alice.call('/ai/connection')).connected, false);
});
test('upload limits and account quota reject before accepting bytes; discarded reservations are released', async () => {
  assert.equal((await alice.raw('/uploads', { name: 'too-big.mp4', size: 3 * 1024 ** 3 })).status, 413);
  const small = await startAPI(path.join(directory, 'quota'), { quota: 100, maxUpload: 100 });
  try {
    await createUser(small.store, 'quota@example.com', 'a-long-test-password'); const c = client(() => small); await c.login('quota@example.com');
    const upload = await c.call('/uploads', { name: 'one.mp4', size: 80 });
    assert.equal((await c.raw('/uploads', { name: 'two.mp4', size: 21 })).status, 413);
    await c.call(`/uploads/${upload.id}`, undefined, 'DELETE'); assert.equal((await c.call('/uploads', { name: 'two.mp4', size: 100 })).size, 100);
  } finally { await small.close(); }
});

test('cloud ingestion rejects playlists and refuses foreign project/result application', async () => {
  await assert.rejects(alice.upload(Buffer.from('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\nhttp://127.0.0.1:1/private.m3u8\n'), 'pretend.mp4'), /400: Upload an MP4/);
  assert.equal((await bob.raw(`/projects/${project.id}`, undefined, 'DELETE')).status, 404);
  const completed = (await alice.call('/jobs')).find(x => x.status === 'completed' && x.type === 'analyze');
  assert.equal((await bob.raw(`/jobs/${completed.id}/apply`, {})).status, 404);
});

test('cloud effect assets survive project save and mix only through owned server metadata', async () => {
  const samples = Float32Array.from({ length: 24000 }, (_, i) => 0.02 * Math.sin(i * Math.PI / 24));
  const effect = await alice.upload(pcmWav(samples), 'Quiet effect.wav', 'effect');
  const effects = { assets: [effect], clips: [{ id: randomUUID(), assetId: effect.id, start: 1, offset: 0, duration: 0.3, gainDb: -20, muted: false }] };
  project = await alice.call(`/projects/${project.id}`, { ...project, data: { ...project.data, effects } }, 'PUT');
  assert.equal(project.data.effects.assets[0].id, effect.id);
  assert.equal((await alice.raw(`/effects/${effect.id}`, undefined, 'DELETE')).status, 409);
  assert.equal((await bob.raw(`/effects/${effect.id}`, undefined, 'DELETE')).status, 404);
  const job = await alice.call('/jobs', jobInput({ type: 'export', cuts: [], effects }));
  const result = await terminal(job.id); assert.equal(result.status, 'completed', result.error);
  assert.equal(result.result.audioMix.mixedClips, 1);
});
