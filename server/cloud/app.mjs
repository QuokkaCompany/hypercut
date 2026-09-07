import express from 'express';
import path from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openStore, authenticate, createSession, sessionFor, requireValue } from './store.mjs';
import { CHUNK_BYTES, installUploads } from './uploads.mjs';
import { installJobs, validateOwnedProject, activeStatuses } from './jobs.mjs';
import { publicMedia, playbackFile } from '../media.mjs';
import { publicEffect } from '../effects.mjs';
import { capture } from '../process.mjs';
import { transcriptionStatus } from '../transcription.mjs';
import { renderCaptionImages } from '../caption-rendering.mjs';
import { validateCaptionStyle } from '../../shared/caption-style.mjs';
import { isCaptionLanguage } from '../../shared/languages.mjs';
import { installAIRoutes } from '../ai.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const publicProject = x => ({ id: x.id, name: x.name, mediaId: x.mediaId, data: x.data, version: x.version, createdAt: x.createdAt });
export async function createCloudApp({ dataDir = path.join(root, '.hypercut/cloud'), distDir = path.join(root, 'dist'), publicURL, quota = 10 * 1024 ** 3, maxUpload = 2 * 1024 ** 3, aiFetch } = {}) {
  requireValue(Number(process.versions.node.split('.')[0]) >= 24, 400, 'Cloud requires Node.js 24 or newer.');
  requireValue(Number.isSafeInteger(quota) && quota > 0 && Number.isSafeInteger(maxUpload) && maxUpload > 0, 400, 'Storage limits must be positive integers.');
  const origin = new URL(publicURL);
  requireValue(origin.pathname === '/' && !origin.search && !origin.hash && !origin.username && !origin.password, 400, 'PUBLIC_URL must be an origin.');
  requireValue(origin.protocol === 'https:' || (origin.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(origin.hostname)), 400, 'Cloud requires HTTPS outside loopback.');
  const secure = origin.protocol === 'https:', store = openStore(path.resolve(dataDir)), app = express(), lifecycle = new AbortController();
  const pending = new Set(), aiSessions = new Map(), busy = new Set(), playback = new Map(), loginLimits = new Map();
  const route = fn => (req, res, next) => {
    const task = Promise.resolve().then(() => fn(req, res)); pending.add(task);
    task.catch(next).finally(() => pending.delete(task));
  };
  const limited = fn => route(async (req, res) => {
    const owner = req.session.owner; requireValue(!busy.has(owner), 429, 'Another media request is still running.');
    busy.add(owner); try { await fn(req, res); } finally { busy.delete(owner); }
  });
  const cookie = (value, maxAge = 43200) => `hypercut_session=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    if (secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
    if (req.headers.host !== origin.host) return res.status(403).json({ error: 'Unrecognized host.' });
    if (!req.path.startsWith('/api')) return next();
    res.setHeader('Cache-Control', 'no-store');
    if (req.headers.origin && req.headers.origin !== origin.origin || req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: 'Cross-origin request rejected.' });
    if (['/api/runtime', '/api/health', '/api/auth/login'].includes(req.path)) return next();
    const session = sessionFor(store, req.headers.cookie);
    if (!session) return res.status(401).json({ error: 'Sign in to continue.' });
    req.session = session;
    // Media elements cannot set custom headers; cookie authentication remains mandatory on every read.
    if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-hypercut-token'] !== session.csrf) return res.status(403).json({ error: 'Session token mismatch. Reload the page.' });
    next();
  });
  app.use('/api/uploads/:id/chunks/:offset', express.raw({ type: 'application/octet-stream', limit: CHUNK_BYTES }));
  app.use(express.json({ limit: '10mb' }));
  app.get('/api/runtime', (_req, res) => res.json({ mode: 'cloud' }));
  app.get('/api/health', (_req, res) => { store.db.prepare('SELECT 1').get(); res.json({ ready: true }); });
  app.post('/api/auth/login', route(async (req, res) => {
    // Bound both concurrency and attempts; never trust client-supplied forwarding headers.
    const now = Date.now(), key = req.socket.remoteAddress;
    for (const [id, entry] of loginLimits) if (entry.until <= now) loginLimits.delete(id);
    const limit = loginLimits.get(key) || { attempts: 0, active: 0, until: now + 60_000 };
    requireValue(limit.attempts < 20 && limit.active < 4 && loginLimits.size < 10000, 429, 'Too many sign-in attempts. Try again in a minute.');
    limit.attempts++; limit.active++; loginLimits.set(key, limit);
    try {
      const user = await authenticate(store, req.body?.email, req.body?.password), session = createSession(store, user.id);
      res.setHeader('Set-Cookie', cookie(session.cookie)); res.json({ user, token: session.csrf });
    } finally { limit.active--; }
  }));
  app.get('/api/auth/me', (req, res) => res.json({ user: { id: req.session.owner, email: req.session.email }, token: req.session.csrf }));
  app.post('/api/auth/logout', route(async (req, res) => {
    store.db.prepare('DELETE FROM sessions WHERE id=?').run(req.session.id);
    await aiSessions.get(req.session.id)?.api.close(); aiSessions.delete(req.session.id);
    res.setHeader('Set-Cookie', cookie('', 0)); res.json({ signedOut: true });
  }));
  let tools;
  app.get('/api/config', route(async (req, res) => {
    tools ??= await Promise.all(['ffmpeg', 'ffprobe'].map(async name => { try { return { name, available: true, version: (await capture(name, ['-version'])).split('\n')[0] }; } catch { return { name, available: false, error: `${name} is unavailable on the host.` }; } }));
    res.json({ mode: 'cloud', token: req.session.csrf, tools, maxUploadBytes: maxUpload, quotaBytes: quota, usedBytes: store.usage(req.session.owner), aiProviders: ['openai', 'anthropic'] });
  }));
  installUploads(app, route, { store, quota, maxUpload, signal: lifecycle.signal });
  installJobs(app, route, { store, quota });
  app.get('/api/media', (req, res) => res.json(store.list('media', req.session.owner).map(publicMedia)));
  app.get('/api/media/:id', (req, res) => res.json(publicMedia(store.need('media', req.params.id, req.session.owner))));
  app.get('/api/effects', (req, res) => res.json(store.list('effect', req.session.owner).map(publicEffect)));
  app.get('/api/projects', (req, res) => res.json(store.list('project', req.session.owner).map(publicProject)));
  app.get('/api/projects/:id', (req, res) => res.json(publicProject(store.need('project', req.params.id, req.session.owner))));
  function saveProject(req, id) {
    const owner = req.session.owner, { name, mediaId, data, version } = req.body;
    requireValue(typeof name === 'string' && name.trim().length > 0 && name.length <= 200, 400, 'Project name must contain 1–200 characters.');
    return store.transaction(() => {
      const previous = id ? store.need('project', id, owner) : null;
      if (previous) requireValue(previous.version === version, 409, 'Project changed in another tab. Reopen it before saving.');
      else requireValue(store.list('project', owner).length < 100, 429, 'Project limit reached.');
      return store.put('project', { id: id || randomUUID(), owner, name: name.trim(), mediaId, data: validateOwnedProject(store, owner, mediaId, data), version: (previous?.version || 0) + 1 });
    });
  }
  app.post('/api/projects', (req, res) => res.status(201).json(publicProject(saveProject(req))));
  app.put('/api/projects/:id', (req, res) => res.json(publicProject(saveProject(req, req.params.id))));
  app.delete('/api/projects/:id', (req, res) => {
    const item = store.need('project', req.params.id, req.session.owner);
    requireValue(!store.list('job', item.owner).some(x => x.projectId === item.id && activeStatuses.includes(x.status)), 409, 'Cancel project jobs first.');
    store.remove('project', item.id, item.owner); res.json({ deleted: true });
  });
  app.get('/api/media/:id/file', limited(async (req, res) => {
    const source = store.need('media', req.params.id, req.session.owner), key = source.id;
    let item = playback.get(key); if (!item) { item = source; if (playback.size > 100) playback.delete(playback.keys().next().value); playback.set(key, item); }
    const directory = path.join(store.directory, 'playback', item.id); await mkdir(directory, { recursive: true });
    const file = await playbackFile(item, req.query.trackIndex === undefined ? item.audioTracks[0]?.index : Number(req.query.trackIndex), directory, { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(30 * 60_000)]) });
    res.type('video/mp4').sendFile(file, { dotfiles: 'allow' });
  }));
  app.get('/api/transcription/status', route(async (_req, res) => res.json(await transcriptionStatus(undefined, { signal: lifecycle.signal }))));
  app.post('/api/captions/style-preview', limited(async (req, res) => {
    const { mediaId, text, captionStyle, language } = req.body, item = store.need('media', mediaId, req.session.owner);
    requireValue(typeof text === 'string' && text.trim().length > 0 && text.length <= 2000 && (language === undefined || isCaptionLanguage(language)), 400, 'Invalid caption preview.');
    res.json(await renderCaptionImages({ mode: 'sample', language, text, style: validateCaptionStyle(captionStyle), width: Math.ceil(item.width / 2) * 2, height: Math.ceil(item.height / 2) * 2 }, { signal: AbortSignal.any([lifecycle.signal, AbortSignal.timeout(30000)]) }));
  }));
  app.get('/api/exports', (req, res) => res.json(store.list('export', req.session.owner).map(({ path: omitted, owner, ...safe }) => safe)));
  app.get('/api/exports/:id', (req, res) => {
    const output = store.need('export', req.params.id, req.session.owner);
    if (req.query.download) res.download(output.path, output.name, { dotfiles: 'allow' });
    else res.type(output.mime || 'video/mp4').sendFile(output.path, { dotfiles: 'allow' });
  });
  for (const kind of ['media', 'effect', 'export']) app.delete(`/api/${kind === 'effect' ? 'effects' : kind === 'export' ? 'exports' : 'media'}/:id`, limited(async (req, res) => {
    const item = store.need(kind, req.params.id, req.session.owner);
    if (kind !== 'export') {
      const jobs = store.list('job', item.owner).filter(x => activeStatuses.includes(x.status));
      requireValue(!jobs.some(x => kind === 'media' ? x.mediaId === item.id : x.input.effects?.assets?.some(a => a.id === item.id)), 409, 'An active job uses this file.');
      requireValue(!store.list('project', item.owner).some(x => kind === 'media' ? x.mediaId === item.id : x.data.effects.assets.some(a => a.id === item.id)), 409, 'A saved project uses this file.');
    }
    store.db.prepare("UPDATE records SET data=json_set(data,'$.deleting',1) WHERE kind=? AND id=? AND owner=?").run(kind, item.id, item.owner);
    try { await rm(item.path, { force: true }); } catch (error) { store.db.prepare("UPDATE records SET data=json_remove(data,'$.deleting') WHERE kind=? AND id=? AND owner=?").run(kind, item.id, item.owner); throw error; }
    if (kind === 'media') { playback.delete(item.id); await rm(path.join(store.directory, 'playback', item.id), { recursive: true, force: true }); }
    store.remove(kind, item.id, item.owner);
    for (const upload of store.list('upload', item.owner)) if (upload.result?.id === item.id) { await rm(path.join(store.directory, 'uploads', upload.id), { recursive: true, force: true }); store.remove('upload', upload.id, item.owner); }
    res.json({ deleted: true });
  }));
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/ai/')) return next();
    if (req.path.startsWith('/api/ai/claude') || req.path.startsWith('/api/ai/shares')) return res.status(404).json({ error: 'Local AI integrations are available in the local edition.' });
    if (req.path === '/api/ai/connection' && req.method === 'POST' && !['openai', 'anthropic'].includes(req.body?.provider)) return res.status(400).json({ error: 'Cloud supports your own OpenAI or Anthropic API key. Local providers are available in the local edition.' });
    for (const [id, entry] of aiSessions) if (entry.expires <= Date.now()) { void entry.api.close(); aiSessions.delete(id); }
    let entry = aiSessions.get(req.session.id);
    if (!entry) {
      if (aiSessions.size >= 100) return res.status(429).json({ error: 'AI session limit reached.' });
      const router = express.Router(); entry = { router, api: installAIRoutes(router, route, { fetchImpl: aiFetch }), expires: req.session.expires }; aiSessions.set(req.session.id, entry);
    }
    entry.router(req, res, next);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
  app.use(express.static(distDir));
  app.use((req, res, next) => req.method === 'GET' ? res.sendFile(path.join(distDir, 'index.html'), error => error && next(error)) : next());
  app.use((error, _req, res, _next) => {
    const status = error.status || (error instanceof SyntaxError ? 400 : 400);
    const message = String(error.message || 'Request failed.').replaceAll(store.directory, '[storage]').slice(0, 500);
    if (!res.headersSent) res.status(status).json({ error: message });
  });
  return { app, store, async close() { lifecycle.abort(); await Promise.allSettled([...pending, ...[...aiSessions.values()].map(x => x.api.close())]); store.close(); } };
}
export async function startCloudServer(options = {}) {
  const instance = await createCloudApp(options);
  const http = await new Promise((resolve, reject) => { const server = instance.app.listen(options.port ?? 4328, options.host ?? '127.0.0.1', () => resolve(server)); server.on('error', reject); });
  return { ...instance, url: `http://127.0.0.1:${http.address().port}`, async close() { const closed = new Promise(resolve => http.close(resolve)); await instance.close(); http.closeAllConnections(); await closed; } };
}
