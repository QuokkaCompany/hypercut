import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';
import { startCloudServer } from '../../server/cloud/app.mjs';
import { digest } from '../../server/cloud/store.mjs';
import { CHUNK_BYTES } from '../../server/cloud/uploads.mjs';
export async function freePort() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
export async function startAPI(dataDir, extra = {}) {
  const port = await freePort(); return startCloudServer({ port, dataDir, publicURL: `http://127.0.0.1:${port}`, ...extra });
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
  const child = spawn(process.execPath, ['--input-type=module', '-e', `import { startWorker } from './server/cloud/worker.mjs'; const worker = await startWorker({dataDir:process.env.HYPERCUT_TEST_DATA,pollMs:30,leaseMs:900}); process.on('SIGTERM',()=>worker.close().then(()=>process.exit()));`], { cwd: path.resolve('.'), env: { ...process.env, HYPERCUT_TEST_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', x => errors += x); child.stdout.resume();
  return { child, errors: () => errors, async close(signal = 'SIGTERM') { if (child.exitCode !== null || child.signalCode) return; const exited = once(child, 'exit'); child.kill(signal); await exited; } };
}
