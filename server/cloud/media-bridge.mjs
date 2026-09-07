// Private, parent-owned Unix socket. No public listener or metadata database.
import express from 'express';
import { chmod, mkdir, open, rm } from 'node:fs/promises';
import path from 'node:path';
import { capture } from '../process.mjs';
import { inspectMedia, publicMedia, playbackFile } from '../media.mjs';
import { inspectEffect, publicEffect } from '../effects.mjs';
import { transcriptionStatus } from '../transcription.mjs';
import { renderCaptionImages } from '../caption-rendering.mjs';
import { validateCaptionStyle } from '../../shared/caption-style.mjs';
import { isCaptionLanguage } from '../../shared/languages.mjs';
import { validateMediaJob } from '../engine.mjs';
import { validateOwnedProject } from './jobs.mjs';
import { installAIRoutes } from '../ai.mjs';
import { requireValue } from './store.mjs';

const socket = process.argv[2];
if (!socket) throw new Error('A private socket path is required.');
const lifecycle = new AbortController(), pending = new Set(), sessions = new Map(), playback = new Map();
const app = express(); app.disable('x-powered-by'); app.use(express.json({ limit: '12mb' }));
const route = fn => (req, res, next) => {
  const abort = new AbortController(); const signal = AbortSignal.any([lifecycle.signal, abort.signal]);
  const close = () => { if (!res.writableEnded) abort.abort(); }; res.once('close', close);
  const promise = Promise.resolve().then(() => fn(req, res, signal)); pending.add(promise);
  promise.catch(next).finally(() => { pending.delete(promise); res.off('close', close); });
};
app.get('/health', (_req, res) => res.json({ ready: true }));
app.post('/bridge', route(async (req, res, signal) => {
  const { op, media, effects = [], input } = req.body;
  let result;
  switch (op) {
    case 'tools': result = await Promise.all(['ffmpeg', 'ffprobe'].map(async name => { try { return { name, available: true, version: (await capture(name, ['-version'], { signal })).split('\n')[0] }; } catch { return { name, available: false, error: `${name} is unavailable on the host.` }; } })); break;
    case 'transcription-status': result = await transcriptionStatus(undefined, { signal }); break;
    case 'validate-job': validateMediaJob(input, media); result = {}; break;
    case 'validate-project': {
      const records = new Map([['media:' + media.id, media], ...effects.map(x => ['effect:' + x.id, x])]);
      const store = { need(kind, id, owner) { const value = records.get(`${kind}:${id}`); requireValue(value?.owner === owner, 404, 'Record not found.'); return value; } };
      result = validateOwnedProject(store, media.owner, media.id, input); break;
    }
    case 'inspect': {
      const { file, name, kind } = input, handle = await open(file, 'r'), header = Buffer.alloc(12);
      try { await handle.read(header, 0, 12, 0); } finally { await handle.close(); }
      const atom = header.toString('ascii', 4, 8), magic = header.toString('ascii', 0, 4);
      if (kind === 'media') {
        requireValue(['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(atom), 400, 'Upload an MP4 or MOV file, not a playlist or URL.');
        result = await inspectMedia(file, name, signal, { inputFormat: 'mov' });
        requireValue(result.duration <= 7200 && result.width > 0 && result.height > 0 && result.width * result.height <= 3840 * 2160 && result.fps <= 120 && result.audioTracks.length <= 32 && result.audioTracks.every(x => x.channels <= 8), 400, 'Cloud beta supports up to two hours, 4K, 120 fps and eight audio channels.');
      } else {
        requireValue(kind === 'effect' && (magic === 'RIFF' || magic === 'fLaC' || magic === 'OggS' || ['ftyp', 'moov'].includes(atom) || header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 255 && (header[1] & 0xe0) === 0xe0)), 400, 'Upload WAV, FLAC, Ogg, MP3, AAC or M4A audio, not a playlist.');
        result = await inspectEffect(file, name, signal);
      }
      result = { asset: result, public: (kind === 'media' ? publicMedia : publicEffect)(result) }; break;
    }
    case 'playback': {
      let item = playback.get(media.id); if (!item) { item = media; if (playback.size >= 100) playback.delete(playback.keys().next().value); playback.set(media.id, item); }
      await mkdir(input.directory, { recursive: true });
      result = { path: await playbackFile(item, input.trackIndex ?? item.audioTracks[0]?.index, input.directory, { signal }) }; break;
    }
    case 'forget-playback': playback.delete(input.id); result = {}; break;
    case 'style-preview': {
      const { text, language, captionStyle } = input;
      requireValue(typeof text === 'string' && text.trim() && text.length <= 2000 && (language === undefined || isCaptionLanguage(language)), 400, 'Invalid caption preview.');
      result = await renderCaptionImages({ mode: 'sample', text, language, style: validateCaptionStyle(captionStyle), width: Math.ceil(media.width / 2) * 2, height: Math.ceil(media.height / 2) * 2 }, { signal }); break;
    }
    case 'close-session': { const entry = sessions.get(input.id); sessions.delete(input.id); await entry?.api.close(); result = {}; break; }
    default: requireValue(false, 400, 'Unknown media operation.');
  }
  res.json(result);
}));
app.use((req, res, next) => {
  if (!req.path.startsWith('/api/ai/')) return next();
  if (req.path.startsWith('/api/ai/claude') || req.path.startsWith('/api/ai/shares')) return res.status(404).json({ error: 'Local AI integrations are available in the local edition.' });
  if (req.path === '/api/ai/connection' && req.method === 'POST' && !['openai', 'anthropic'].includes(req.body?.provider)) return res.status(400).json({ error: 'Cloud supports your own OpenAI or Anthropic API key. Local providers are available in the local edition.' });
  const id = req.headers['x-hypercut-session'], expires = Number(req.headers['x-hypercut-session-expires']);
  if (!/^[a-f0-9]{64}$/.test(id || '') || !Number.isFinite(expires) || expires <= Date.now()) return res.status(401).json({ error: 'Session expired.' });
  for (const [key, entry] of sessions) if (entry.expires <= Date.now()) { void entry.api.close(); sessions.delete(key); }
  let entry = sessions.get(id);
  if (!entry) {
    if (sessions.size >= 100) return res.status(429).json({ error: 'AI session limit reached.' });
    const router = express.Router(); entry = { router, api: installAIRoutes(router, route), expires }; sessions.set(id, entry);
  }
  entry.router(req, res, next);
});
app.use((_req, res) => res.status(404).json({ error: 'Unknown media route.' }));
app.use((error, _req, res, _next) => { if (!res.headersSent) res.status(error.status || 400).json({ error: String(error.message).slice(0, 500) }); });
const server = app.listen(socket, () => { void chmod(socket, 0o600); });
let closing = false;
async function close() {
  if (closing) return; closing = true; lifecycle.abort(); server.close(); server.closeAllConnections();
  await Promise.allSettled([...pending, ...[...sessions.values()].map(entry => entry.api.close())]);
  await rm(socket, { force: true }); process.exit();
}
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void close(); });
// Exit if the parent disappears without a normal shutdown.
setInterval(() => { if (process.ppid === 1) void close(); }, 1000).unref();
