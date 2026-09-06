import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, rename, rm, stat } from 'node:fs/promises';

export class DownloadCancelledError extends Error {
  constructor(signalName) {
    super('모델 다운로드 준비를 취소했습니다.');
    this.name = 'AbortError';
    this.signalName = signalName;
    this.exitCode = signalName === 'SIGINT' ? 130 : 143;
  }
}

export async function withDownloadSignals(operation) {
  const controller = new AbortController();
  const interrupt = () => controller.abort(new DownloadCancelledError('SIGINT'));
  const terminate = () => controller.abort(new DownloadCancelledError('SIGTERM'));
  // Keep handlers until asynchronous cleanup finishes, including repeated signals.
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  try {
    const result = await operation(controller.signal);
    controller.signal.throwIfAborted();
    return result;
  }
  finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  }
}

export async function fileSHA256(file, signal) {
  signal?.throwIfAborted();
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(file, { signal })) hash.update(bytes);
  signal?.throwIfAborted();
  return hash.digest('hex');
}

export async function downloadVerifiedFile(url, file, expectedSHA256, maxBytes, { signal, timeoutMs = 600000, onProgress } = {}) {
  if (!/^[0-9a-f]{64}$/.test(expectedSHA256) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0)
    throw new TypeError('고정 해시와 양수 최대 크기가 필요합니다.');
  const activeSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  activeSignal.throwIfAborted();
  const temporary = `${file}.${randomUUID()}.download`;
  let response, ownsTemporary = false;
  try {
    const existingHash = await fileSHA256(file, activeSignal).catch(error => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    activeSignal.throwIfAborted();
    if (existingHash === expectedSHA256) return { status: 'reused', sha256: existingHash, bytes: (await stat(file)).size };
    response = await fetch(url, { signal: activeSignal });
    if (!response.ok || !response.body) throw new Error(`다운로드 실패: ${response.status}`);
    let length = 0;
    const handle = await open(temporary, 'wx');
    ownsTemporary = true;
    try {
      for await (const chunk of response.body) {
        activeSignal.throwIfAborted();
        length += chunk.length;
        if (length > maxBytes) throw new Error('다운로드 크기가 허용 범위를 넘습니다.');
        await handle.writeFile(chunk);
        onProgress?.({ bytes: length, maxBytes });
      }
      await handle.sync();
    } finally { await handle.close(); }
    activeSignal.throwIfAborted();
    // Read back the persisted bytes before publishing the final model path.
    if (await fileSHA256(temporary, activeSignal) !== expectedSHA256)
      throw new Error('다운로드 해시가 고정 버전과 일치하지 않습니다.');
    activeSignal.throwIfAborted();
    await rename(temporary, file);
    return { status: 'downloaded', sha256: expectedSHA256, bytes: length };
  } catch (error) {
    if (activeSignal.aborted) throw activeSignal.reason;
    throw error;
  } finally {
    await response?.body?.cancel().catch(() => {});
    if (ownsTemporary) await rm(temporary, { force: true });
  }
}
