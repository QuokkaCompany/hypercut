// Build-time tooling only; the resulting backend does not need Node.
import { spawn } from 'node:child_process';
import { mkdir, copyFile, realpath } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve('.');
await mkdir('.cache/bin', { recursive: true });
await new Promise((resolve, reject) => {
  const child = spawn('go', ['build', '-trimpath', '-o', '.cache/bin/hypercut-cloud', './cmd/hypercut-cloud'], { stdio: 'inherit' });
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Go build failed: ${code}`)));
});
const nativeName = process.platform === 'darwin' ? 'libonnxruntime.1.dylib' : 'libonnxruntime.so.1';
const native = path.join(root, 'node_modules/onnxruntime-node/bin/napi-v6', process.platform, process.arch, nativeName);
await mkdir('.cache/native', { recursive: true });
await copyFile(await realpath(native), path.join('.cache/native', nativeName));
console.log('Go backend and standalone ONNX Runtime prepared in .cache/.');
