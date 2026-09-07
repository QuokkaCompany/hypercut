import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { startCloudServer } from '../reference/server/cloud/app.mjs';
import { digest, openStore } from '../reference/server/cloud/store.mjs';
import { CHUNK_BYTES } from '../reference/server/cloud/uploads.mjs';
export async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
export async function startAPI(dataDir, extra = {}) {
  const port = await freePort();
  if ((extra.backend || process.env.HYPERCUT_CLOUD_API) !== 'go') return startCloudServer({ port, dataDir, publicURL: `http://127.0.0.1:${port}`, ...extra });
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(path.resolve('.cache/bin/hypercut-cloud'), ['serve'], { env: { ...process.env, PORT: String(port), HYPERCUT_CLOUD_HOST: '127.0.0.1', HYPERCUT_PUBLIC_URL: url, HYPERCUT_CLOUD_DATA: dataDir, ...(extra.quota ? { HYPERCUT_CLOUD_QUOTA_BYTES: String(extra.quota) } : {}), ...(extra.maxUpload ? { HYPERCUT_CLOUD_MAX_UPLOAD_BYTES: String(extra.maxUpload) } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '', startupError; child.on('error', error => { startupError = error; }); child.stdout.resume(); child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-4000); });
  const stop = async () => { if (startupError || child.exitCode !== null || child.signalCode) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; };
  try { await until(async () => { if (startupError) throw startupError; if (child.exitCode !== null) throw new Error(`Go API exited: ${errors}`); try { return (await fetch(`${url}/api/health`)).ok; } catch { return false; } }, 30000); }
  catch (error) { await stop(); throw error; }
  const store = openStore(dataDir);
  return { url, store, child, async close() { await stop(); store.close(); } };
}
export function client(getServer) {
  let cookie = '', token = '';
  return {
    async raw(route, body, method = body ? 'POST' : 'GET', headers = {}) {
      const binary = Buffer.isBuffer(body);
      return fetch(`${getServer().url}/api${route}`, { method, headers: { Cookie: cookie, 'X-Hypercut-Token': token, 'Content-Type': binary ? 'application/octet-stream' : 'application/json', ...headers }, body: body === undefined ? undefined : binary ? body : JSON.stringify(body) });
    },
    async call(route, body, method, headers) {
      const response = await this.raw(route, body, method, headers), value = await response.json();
      if (!response.ok) throw new Error(`${response.status}: ${value.error}`); return value;
    },
    async login(email, password = 'a-long-test-password') {
      const response = await this.raw('/auth/login', { email, password }), value = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(value));
      cookie = response.headers.get('set-cookie').split(';')[0]; token = value.token; return value;
    },
    async upload(bytes, name = 'source.mp4', kind = 'media') {
      const state = await this.call('/uploads', { name, size: bytes.length, kind });
      for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
        const chunk = bytes.subarray(offset, offset + CHUNK_BYTES);
        await this.call(`/uploads/${state.id}/chunks/${offset}`, chunk, 'PUT', { 'X-Content-SHA256': digest(chunk) });
      }
      return this.call(`/uploads/${state.id}/complete`, {});
    },
  };
}
export async function until(fn, timeout = 60000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const result = await fn(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 30)); }
  throw new Error('Timed out waiting for cloud state.');
}
export function launchWorker(dataDir) {
  const child = process.env.HYPERCUT_CLOUD_WORKER === 'go' ? spawn(path.resolve('.cache/bin/hypercut-cloud'), ['worker'], { cwd: path.resolve('.'), env: { ...process.env, HYPERCUT_CLOUD_DATA: dataDir, HYPERCUT_WORKER_POLL_MS: '30', HYPERCUT_WORKER_LEASE_MS: '900' }, stdio: ['ignore','pipe','pipe'] }) : spawn(process.execPath, ['--input-type=module', '-e', `import { startWorker } from './tests/reference/server/cloud/worker.mjs'; const worker = await startWorker({dataDir:process.env.HYPERCUT_TEST_DATA,pollMs:30,leaseMs:900}); process.on('SIGTERM',()=>worker.close().then(()=>process.exit()));`], { cwd: path.resolve('.'), env: { ...process.env, HYPERCUT_TEST_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', x => errors += x); child.stdout.resume();
  return { child, errors: () => errors, async close(signal = 'SIGTERM') { if (child.exitCode !== null || child.signalCode) return; const exited = once(child, 'exit'); child.kill(signal); await exited; } };
}
