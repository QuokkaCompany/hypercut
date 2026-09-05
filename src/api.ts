import type { Job, Media } from './types';
let token = '';
export async function bootstrap() {
  const response = await fetch('/api/config');
  if (!response.ok) throw new Error('로컬 편집 엔진에 연결할 수 없습니다.');
  const config = await response.json(); token = config.token; return config as { token: string; tools: { name: string; available: boolean; error?: string }[] };
}
export async function request<T>(route: string, body?: unknown, method?: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api${route}`, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', 'X-Hypercut-Token': token }, body: body ? JSON.stringify(body) : undefined, signal });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '요청에 실패했습니다.');
  return value;
}
export function fileURL(mediaId: string, trackIndex: number) { return `/api/media/${mediaId}/file?token=${token}&trackIndex=${trackIndex}`; }
export function outputURL(id: string, download = false) { return `/api/exports/${id}?token=${token}${download ? '&download=1' : ''}`; }
export function upload(file: File, onProgress: (percentage: number) => void, signal: AbortSignal): Promise<Media> {
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
  for (;;) { signal?.throwIfAborted(); const job = await request<Job>(`/jobs/${id}`, undefined, undefined, signal); update(job); if (job.status !== 'running') return job; await new Promise(resolve => setTimeout(resolve, 300)); }
}
