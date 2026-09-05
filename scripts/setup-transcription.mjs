import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, stat, rename, rm, copyFile, chmod, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRANSCRIPTION_MODEL as model } from '../server/transcription.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const build = path.join(root, '.hypercut/build'), runtime = path.join(root, '.hypercut/transcription');
const sourceHash = '89051d8fca516a3ad1f5c2f8f9d2fccb089afbaec338fca3f8731999babc6f81';
async function sha(file) { const hash = createHash('sha256'); for await (const bytes of createReadStream(file)) hash.update(bytes); return hash.digest('hex'); }
async function download(url, file, hash, maxBytes) {
  if (await sha(file).catch(() => '') === hash) { console.log(`확인됨: ${path.basename(file)}`); return; }
  const temporary = `${file}.${randomUUID()}.download`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(600000) });
    if (!response.ok || !response.body) throw new Error(`다운로드 실패: ${response.status}`);
    let length = 0, lastReport = 0;
    const { open } = await import('node:fs/promises');
    const handle = await open(temporary, 'wx');
    try {
      for await (const chunk of response.body) {
        length += chunk.length;
        if (length > maxBytes) throw new Error('다운로드 크기가 허용 범위를 넘습니다.');
        await handle.writeFile(chunk);
        if (Date.now() - lastReport > 2000) { console.log(`${path.basename(file)}: ${(length / 1024 ** 2).toFixed(1)} MiB`); lastReport = Date.now(); }
      }
      await handle.sync();
    } finally { await handle.close(); }
    if (await sha(temporary) !== hash) throw new Error('다운로드 해시가 고정 버전과 일치하지 않습니다.');
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }); }
}
function run(executable, args) {
  return new Promise((resolve, reject) => { const child = spawn(executable, args, { cwd: root, stdio: 'inherit' }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} 실패: ${code}`))); });
}
if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('현재 자동 준비는 Apple Silicon macOS를 지원합니다.');
await mkdir(build, { recursive: true }); await mkdir(runtime, { recursive: true });
console.log('공개 로컬 모델과 빌드 도구를 다운로드합니다. API 계정이나 유료 요청은 사용하지 않습니다.');
await download(`https://codeload.github.com/ggml-org/whisper.cpp/tar.gz/${model.revision}`, path.join(build, 'whisper-source.tar.gz'), sourceHash, 20 * 1024 ** 2);
await run('tar', ['-xzf', path.join(build, 'whisper-source.tar.gz'), '-C', build]);
const cmake = path.join(build, 'toolchain/bin/cmake');
if (!await stat(cmake).catch(() => null)) {
  await run('python3', ['-m', 'venv', path.join(build, 'toolchain')]);
  await run(path.join(build, 'toolchain/bin/pip'), ['install', 'cmake==4.1.3']);
}
const source = path.join(build, `whisper.cpp-${model.revision}`), compiled = path.join(build, 'whisper-compiled');
await run(cmake, ['-S', source, '-B', compiled, '-DBUILD_SHARED_LIBS=OFF', '-DGGML_METAL=OFF', '-DGGML_NATIVE=OFF', '-DWHISPER_BUILD_TESTS=OFF', '-DWHISPER_BUILD_SERVER=OFF', '-DCMAKE_BUILD_TYPE=Release']);
await run(cmake, ['--build', compiled, '--target', 'whisper-cli', '-j', '8']);
const binary = path.join(compiled, 'bin/whisper-cli');
await run(binary, ['--version']);
const temporary = path.join(runtime, `whisper-cli.${randomUUID()}`);
try { await copyFile(binary, temporary); await chmod(temporary, 0o755); await rename(temporary, path.join(runtime, 'whisper-cli')); }
finally { await rm(temporary, { force: true }); }
await copyFile(path.join(source, 'LICENSE'), path.join(runtime, 'WHISPER-LICENSE'));
await copyFile(path.join(root, 'assets/models/WHISPER-MODEL-LICENSE'), path.join(runtime, 'WHISPER-MODEL-LICENSE'));
await download('https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin', path.join(runtime, model.file), model.sha256, model.size);
await writeFile(path.join(runtime, 'manifest.json'), JSON.stringify({ ...model, platform: process.platform, arch: process.arch, binarySHA256: await sha(path.join(runtime, 'whisper-cli')), sourceSHA256: sourceHash }, null, 2));
console.log('로컬 전사 준비 완료. npm start 또는 npm run package:desktop으로 사용할 수 있습니다.');
