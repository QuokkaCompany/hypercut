import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const binary = path.join(root, '.cache/bin/hypercut-cloud');
await mkdir(path.dirname(binary), { recursive: true });
async function run(command, args, stdin) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: [stdin, 'inherit', 'inherit'] });
    const stop = signal => child.kill(signal);
    const interrupt = () => stop('SIGINT'), terminate = () => stop('SIGTERM');
    process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
    child.once('error', reject);
    child.once('exit', (code, signal) => { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); resolve(code ?? (signal ? 1 : 0)); });
  });
}
try {
  const code = await run(process.execPath, ['scripts/build-backend.mjs'], 'ignore');
  process.exitCode = code || await run(binary, process.argv.slice(2), 'inherit');
} catch (error) { console.error(`Unable to start Go cloud API: ${error.message}. Install Go 1.26+ or use Docker Compose.`); process.exitCode = 1; }
