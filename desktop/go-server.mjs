// Presentation/test adapter only. All HTTP, media, AI and file operations run in Go.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const sourceRoot = fileURLToPath(new URL('../', import.meta.url));
export async function startGoServer({ port = 4327, dataDir, distDir, development = false } = {}) {
  const packaged = process.resourcesPath && !process.defaultApp;
  const root = packaged ? path.join(process.resourcesPath, 'backend') : sourceRoot;
  const binary = process.env.HYPERCUT_GO_BINARY || (packaged ? path.join(root, 'hypercut') : path.join(root, '.cache/bin/hypercut-cloud'));
  const token = randomBytes(32).toString('hex');
  const child = spawn(binary, ['local'], { cwd: root, env: { ...process.env, HYPERCUT_ROOT: root, ...(packaged ? { HYPERCUT_TRANSCRIPTION_DIR: path.join(root, "transcription") } : {}), PORT: String(port), HYPERCUT_DESKTOP_TOKEN: token, HYPERCUT_DEVELOPMENT: development ? '1' : '0', ...(dataDir ? { HYPERCUT_DATA_DIR: dataDir } : {}), ...(distDir ? { HYPERCUT_DIST_DIR: distDir } : {}) }, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '', output = '', url;
  child.stderr.on('data', bytes => { errors = (errors + bytes).slice(-4000); });
  try {
    url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Go server startup timed out.')), 30000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Go server exited (${code}): ${errors}`)); });
      child.stdout.on('data', bytes => { output = (output + bytes).slice(-4000); const match = /HYPERCUT_LOCAL_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(output); if (match) { clearTimeout(timer); resolve(match[1]); } });
    });
  } catch (error) { child.kill('SIGTERM'); throw error; }
  const control = async (op, input = {}) => {
    const response = await fetch(`${url}/api/desktop-control`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hypercut-Desktop-Token': token }, body: JSON.stringify({ op, ...input }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  return { url, child, control,
    registerFile: (file, name) => control('registerFile', { path: file, name }),
    registerEffect: (file, name) => control('registerEffect', { path: file, name }),
    async close() { if (child.exitCode !== null || child.signalCode) return; const exited = once(child, 'exit'); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 10000); try { await exited; } finally { clearTimeout(timer); } },
  };
}
