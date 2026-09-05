import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export function executable(name) {
  const override = process.env[name.toUpperCase() + '_PATH'];
  if (override) return override;
  const bundled = process.resourcesPath && `${process.resourcesPath}/media-tools/${name}`;
  for (const path of [bundled, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) if (path && existsSync(path)) return path;
  return name;
}

export function startProcess(name, args, { signal, onStderr } = {}) {
  if (signal?.aborted) throw new DOMException('작업이 취소되었습니다.', 'AbortError');
  const child = spawn(executable(name), args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stderr = '', timer;
  child.stderr.on('data', data => { stderr = (stderr + data.toString()).slice(-12000); onStderr?.(data.toString()); });
  const abort = () => { child.kill('SIGTERM'); timer = setTimeout(() => child.kill('SIGKILL'), 1000); timer.unref(); };
  signal?.addEventListener('abort', abort, { once: true });
  const done = new Promise((resolve, reject) => {
    child.once('error', error => reject(new Error(error.code === 'ENOENT' ? `${name}를 찾을 수 없습니다. FFmpeg를 설치하거나 실행 경로를 설정해 주세요.` : error.message)));
    child.once('close', (code, signalName) => {
      clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (signal?.aborted) reject(new DOMException('작업이 취소되었습니다.', 'AbortError'));
      else if (signalName) reject(new Error(`${name} 작업이 ${signalName}로 중단되었습니다. 다시 시도해 주세요.`));
      else if (code !== 0) reject(new Error(`${name} 작업 실패: ${stderr.slice(-3000)}`));
      else resolve(stderr);
    });
  });
  // A stream consumer can fail before the process closes; keep rejections observed.
  done.catch(() => {});
  return { child, done };
}

export async function capture(name, args, options = {}) {
  const { child, done } = startProcess(name, args, options);
  const chunks = []; let size = 0;
  for await (const data of child.stdout) { size += data.length; if (size > 64 * 1024 * 1024) { child.kill(); throw new Error('미디어 정보가 너무 큽니다.'); } chunks.push(data); }
  await done;
  return Buffer.concat(chunks).toString();
}
