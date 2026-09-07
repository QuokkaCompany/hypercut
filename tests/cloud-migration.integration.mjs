import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { startAPI, client, launchWorker, until } from './helpers/cloud.mjs';
import { createUser, digest } from '../server/cloud/store.mjs';
import { CHUNK_BYTES } from '../server/cloud/uploads.mjs';
import { DEFAULT_SETTINGS, makeProject } from '../shared/timeline.mjs';
import { generateDemo } from '../scripts/fixtures.mjs';

test('Node → Go → Node → Go retains sessions, partial uploads, projects and queued results', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-migration-')), dataDir = path.join(directory, 'data');
  let server, worker;
  const api = client(() => server);
  const change = async backend => { const previous = server; server = undefined; await previous?.close(); server = await startAPI(dataDir, { backend }); };
  try {
    await change('node');
    await createUser(server.store, 'migrate@example.com', 'a-long-test-password'); await api.login('migrate@example.com');
    const source = Buffer.concat([await readFile(await generateDemo(path.join(directory, 'source.mp4'))), Buffer.alloc(CHUNK_BYTES)]);
    const upload = await api.call('/uploads', { name: 'Migration sample.mp4', size: source.length });
    const first = source.subarray(0, CHUNK_BYTES);
    await api.call(`/uploads/${upload.id}/chunks/0`, first, 'PUT', { 'X-Content-SHA256': digest(first) });
    await change('go');
    assert.equal((await api.call('/runtime')).apiRuntime, 'go');
    assert.equal((await api.call(`/uploads/${upload.id}`)).offset, CHUNK_BYTES);
    for (let offset = CHUNK_BYTES; offset < source.length; offset += CHUNK_BYTES) {
      const chunk = source.subarray(offset, offset + CHUNK_BYTES);
      await api.call(`/uploads/${upload.id}/chunks/${offset}`, chunk, 'PUT', { 'X-Content-SHA256': digest(chunk) });
    }
    const media = await api.call(`/uploads/${upload.id}/complete`, {});
    assert.equal(media.fingerprint, digest(source));
    const project = await api.call('/projects', { name: 'Portable edit', mediaId: media.id, data: makeProject(media, DEFAULT_SETTINGS, media.audioTracks[0].index, []) });
    const job = await api.call('/jobs', { requestId: randomUUID(), mediaId: media.id, projectId: project.id, baseVersion: project.version, type: 'analyze', settings: DEFAULT_SETTINGS, trackIndex: media.audioTracks[0].index });
    await new Promise((resolve, reject) => {
      const child = spawn(path.resolve('.cache/bin/hypercut-cloud'), ['user', 'created-by-go@example.com'], { env: { ...process.env, HYPERCUT_CLOUD_DATA: dataDir }, stdio: ['pipe', 'ignore', 'pipe'] });
      let errors = ''; child.stderr.on('data', data => errors += data); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors))); child.stdin.end('a-long-test-password');
    });
    await change('node');
    const other = client(() => server); await other.login('created-by-go@example.com');
    assert.equal((await api.call('/projects'))[0].id, project.id);
    assert.equal((await api.call(`/jobs/${job.id}`)).status, 'queued');
    worker = launchWorker(dataDir);
    await until(async () => (await api.call(`/jobs/${job.id}`)).status === 'completed');
    const applied = await api.call(`/jobs/${job.id}/apply`, {}); assert.equal(applied.data.cuts.length, 5);
    await worker.close(); worker = null;
    await change('go');
    const restored = await api.call(`/projects/${project.id}`);
    assert.equal(restored.version, applied.version); assert.deepEqual(restored.data.cuts, applied.data.cuts);
    assert.equal((await api.call(`/jobs/${job.id}`)).appliedVersion, applied.version);
  } finally { await worker?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); }
});
