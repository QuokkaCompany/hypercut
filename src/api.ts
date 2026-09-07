import type { Job, Media, EffectAsset } from './types';
let token = '';
export let cloudMode = false;
export async function bootstrap() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('로컬 편집 엔진에 연결할 수 없습니다.');
  const config = await response.json(); token = config.token; cloudMode = config.mode === 'cloud'; return config as { token: string; tools: { name: string; available: boolean; error?: string }[] };
}
export async function request<T>(route: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${route}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: body ? JSON.stringify(body) : undefined, signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '요청에 실패했습니다.');
  return value;
}
export function fileURL(mediaId: string, trackIndex: number) { return `/api/media/${mediaId}/file?${cloudMode ? '' : `token=${token}&`}trackIndex=${trackIndex}`; }
export function outputURL(id: string, download = false) { return cloudMode ? `/api/exports/${id}${download ? '?download=1' : ''}` : `/api/exports/${id}?token=${token}${download ? '&download=1' : ''}`; }
export async function uploadEffect(file: File, signal: AbortSignal): Promise<EffectAsset> {
  if (cloudMode) return resumableUpload(file, 'effect', () => {}, signal) as Promise<EffectAsset>;
  const body = new FormData(); body.append('audio', file);
  const response = await fetch('/api/effects', { method: 'POST', headers: { 'X-Hypercut-Token': token }, body, signal });
  const value = await response.json(); if (!response.ok) throw new Error(value.error || '효과음을 불러오지 못했습니다.'); return value;
}
export function upload(file: File, onProgress: (percentage: number) => void, signal: AbortSignal): Promise<Media> {
  if (cloudMode) return resumableUpload(file, 'media', onProgress, signal) as Promise<Media>;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/media'); xhr.setRequestHeader('X-Hypercut-Token', token);
    const abort = () => xhr.abort(); signal.addEventListener('abort', abort, { once: true });
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total); };
    xhr.onload = () => { try { const value = JSON.parse(xhr.responseText); if (xhr.status >= 400) reject(new Error(value.error)); else resolve(value); } catch { reject(new Error('영상 정보를 읽지 못했습니다.')); } };
    xhr.onerror = () => reject(new Error('로컬 서버와 연결이 끊겼습니다.'));
    xhr.onabort = () => reject(new DOMException('가져오기가 취소되었습니다.', 'AbortError'));
    xhr.onloadend = () => signal.removeEventListener('abort', abort);
    const data = new FormData(); data.append('video', file); xhr.send(data);
  });
}
export async function waitJob(id: string, update: (job: Job) => void, signal?: AbortSignal): Promise<Job> {
  for (;;) { signal?.throwIfAborted(); const job = await request<Job>(`/jobs/${id}`, undefined, undefined, signal); update(job); if (!['running', 'queued'].includes(job.status)) return job; await new Promise(resolve => setTimeout(resolve, 300)); }
}

type UploadState = { id: string; offset: number; hashes: string[]; chunkBytes: number; name: string; size: number; kind: string };
async function chunkHash(bytes: ArrayBuffer) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(x => x.toString(16).padStart(2, '0')).join(''); }
async function resumableUpload(file: File, kind: 'media' | 'effect', progress: (fraction: number) => void, signal: AbortSignal): Promise<Media | EffectAsset> {
  const candidates = await request<UploadState[]>('/uploads', undefined, undefined, signal);
  let state: UploadState | undefined;
  for (const candidate of candidates.filter(x => x.name === file.name && x.size === file.size && x.kind === kind)) {
    let matches = true;
    for (let offset = 0; offset < candidate.offset; offset += candidate.chunkBytes) {
      signal.throwIfAborted();
      if (await chunkHash(await file.slice(offset, Math.min(file.size, offset + candidate.chunkBytes)).arrayBuffer()) !== candidate.hashes[offset / candidate.chunkBytes]) { matches = false; break; }
    }
    if (matches) { state = candidate; break; }
  }
  let current: UploadState = state ?? await request<UploadState>('/uploads', { name: file.name, size: file.size, kind }, undefined, signal);
  progress(current.offset / file.size);
  while (current.offset < file.size) {
    signal.throwIfAborted();
    const bytes = await file.slice(current.offset, current.offset + current.chunkBytes).arrayBuffer();
    const response = await fetch(`/api/uploads/${current.id}/chunks/${current.offset}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Hypercut-Token': token, 'X-Content-SHA256': await chunkHash(bytes) }, body: bytes, signal });
    const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Upload failed. Select the same file to resume.');
    current = value as UploadState; progress(current.offset / file.size);
  }
  return request(`/uploads/${current.id}/complete`, {}, undefined, signal);
}
