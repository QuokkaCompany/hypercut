import { validateMediaJob, executeMediaJob, isRequestId } from './engine.mjs';
import { isCaptionLanguage } from '../shared/languages.mjs';
import express from 'express';
import multer from 'multer';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMedia, publicMedia, playbackFile } from './media.mjs';
import { capture } from './process.mjs';
import { installAIRoutes } from './ai.mjs';
import { transcriptionStatus } from './transcription.mjs';
import { validateCaptionStyle } from '../shared/caption-style.mjs';
import { renderCaptionImages } from './caption-rendering.mjs';
import { inspectEffect, publicEffect } from './effects.mjs';
import { EFFECT_LIMITS } from '../shared/effects.mjs';
import { installShareRoutes, isShareExchange } from './mcp-routes.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function createApp({ dataDir = path.join(projectRoot, '.hypercut'), distDir = path.join(projectRoot, 'dist'), development = false, aiFetch, claudeCLI } = {}) {
  const directory = path.join(dataDir, 'sessions', randomUUID());
  await mkdir(directory, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const media = new Map(), jobs = new Map(), exports = new Map();
  const effectAssets = new Map(), effectImports = new Set();
  const cancelledRequests = new Set();
  const captionPreviews = new Set();
  const playbackController = new AbortController();
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    if (!['127.0.0.1', 'localhost'].includes(req.hostname)) return res.status(403).json({ error: '로컬 주소에서만 사용할 수 있습니다.' });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!development) res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'");
    if (req.path.startsWith('/api')) {
      const origin = req.headers.origin;
      const ownOrigin = `http://${req.headers.host}`;
      if (origin && origin !== ownOrigin && !(development && origin === 'http://127.0.0.1:5173')) return res.status(403).json({ error: '이 연결에서는 요청할 수 없습니다.' });
      if (req.headers['sec-fetch-site'] === 'cross-site') return res.status(403).json({ error: '외부 사이트 요청은 허용하지 않습니다.' });
      res.setHeader('Cache-Control', 'no-store');
      if (!['/api/config', '/api/runtime'].includes(req.path) && !isShareExchange(req) && (req.headers['x-hypercut-token'] || req.query.token) !== token) return res.status(401).json({ error: '앱 연결이 만료되었습니다. 새로고침해 주세요.' });
    }
    next();
  });
  app.use(['/api/ai/shares', '/api/mcp-exchange'], express.json({ limit: '128kb' }));
  app.use(express.json({ limit: '10mb' }));
  const shares = installShareRoutes(app);
  const upload = multer({ dest: directory, limits: { fileSize: 20 * 1024 ** 3, files: 1, fields: 2 } });
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const ai = installAIRoutes(app, asyncRoute, { fetchImpl: aiFetch, claudeCLI });
  const findMedia = id => { const item = media.get(id); if (!item) throw new Error('원본 영상을 다시 불러와 주세요.'); return item; };
  const registerFile = async (filePath, name, signal = playbackController.signal) => { const item = await inspectMedia(filePath, name, signal); signal?.throwIfAborted(); media.set(item.id, item); return publicMedia(item); };
  const registerEffect = (filePath, name, signal = playbackController.signal) => {
    const task = inspectEffect(filePath, name, signal).then(item => { signal?.throwIfAborted(); effectAssets.set(item.id, item); return publicEffect(item); });
    effectImports.add(task); task.finally(() => effectImports.delete(task)).catch(() => {}); return task;
  };
  const effectUpload = multer({ dest: directory, limits: { fileSize: EFFECT_LIMITS.bytes, files: 1, fields: 0 } });
  app.post('/api/effects', effectUpload.single('audio'), asyncRoute(async (req, res) => {
    if (!req.file) throw new Error('효과음 파일을 선택해 주세요.');
    const controller = new AbortController(), onClose = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', onClose);
    try { res.json(await registerEffect(req.file.path, Buffer.from(req.file.originalname, 'latin1').toString('utf8'), AbortSignal.any([controller.signal, playbackController.signal]))); }
    catch (error) { await rm(req.file.path, { force: true }); throw error; }
    finally { res.off('close', onClose); }
  }));
  let toolsStatus;
  app.get('/api/runtime', (_req, res) => res.json({ mode: 'local' }));
  app.get('/api/config', asyncRoute(async (_req, res) => {
    toolsStatus ??= await Promise.all(['ffmpeg', 'ffprobe'].map(async name => {
      try { return { name, available: true, version: (await capture(name, ['-version'])).split('\n')[0] }; }
      catch (error) { return { name, available: false, error: error.message }; }
    }));
    res.json({ token, tools: toolsStatus, mode: 'local', maxUploadBytes: 20 * 1024 ** 3 });
  }));
  app.post('/api/media', upload.single('video'), asyncRoute(async (req, res) => {
    if (!req.file) throw new Error('영상 파일을 선택해 주세요.');
    const controller = new AbortController();
    const onClose = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', onClose);
    try { res.json(await registerFile(req.file.path, Buffer.from(req.file.originalname, 'latin1').toString('utf8'), AbortSignal.any([controller.signal, playbackController.signal]))); }
    catch (error) { await rm(req.file.path, { force: true }); throw error; }
    finally { res.off('close', onClose); }
  }));
  app.post('/api/demo', asyncRoute(async (_req, res) => {
    const { generateDemo } = await import('../scripts/fixtures.mjs');
    const demo = path.join(directory, 'demo.mp4');
    await generateDemo(demo);
    res.json(await registerFile(demo, 'HyperCut 검증 샘플.mp4'));
  }));
  app.get('/api/transcription/status', asyncRoute(async (_req, res) => res.json(await transcriptionStatus(undefined, { signal: playbackController.signal }))));
  app.post('/api/captions/style-preview', asyncRoute(async (req, res) => {
    const { mediaId, text, captionStyle } = req.body, item = findMedia(mediaId);
    if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('미리 볼 자막 문구를 확인해 주세요.');
    const controller = new AbortController(), onClose = () => { if (!res.writableEnded) controller.abort(); };
    const language = req.body.language;
    if (language !== undefined && !isCaptionLanguage(language)) throw new Error('자막 언어가 올바르지 않습니다.');
    const task = renderCaptionImages({ mode: 'sample', language, text, style: validateCaptionStyle(captionStyle), width: Math.ceil(item.width / 2) * 2, height: Math.ceil(item.height / 2) * 2 }, { signal: AbortSignal.any([controller.signal, playbackController.signal]) });
    captionPreviews.add(task);
    res.on('close', onClose);
    try { res.json(await task); }
    finally { captionPreviews.delete(task); res.off('close', onClose); }
  }));
  app.get('/api/media/:id/file', asyncRoute(async (req, res) => {
    const item = findMedia(req.params.id);
    const trackIndex = req.query.trackIndex === undefined ? item.audioTracks[0]?.index : Number(req.query.trackIndex);
    const source = await playbackFile(item, trackIndex, directory, { signal: playbackController.signal });
    res.type('video/mp4'); res.sendFile(source, { dotfiles: 'allow' });
  }));
  function startJob(type, item, settings, trackIndex, cuts, requestedId, range, speechProtection, transcription, transcript, captionStyle, effects, textMode) {
    const id = requestedId || randomUUID();
    if (jobs.size > 100) for (const [key, job] of jobs) { if (job.status !== 'running') jobs.delete(key); if (jobs.size <= 50) break; }
    if (jobs.has(id)) throw new Error('이미 처리한 작업 ID입니다. 새 작업으로 다시 요청해 주세요.');
    if (cancelledRequests.has(id)) {
      const cancelled = { id, type, mediaId: item.id, status: 'cancelled', progress: 0, stage: '취소됨', createdAt: Date.now(), finishedAt: Date.now() };
      jobs.set(id, cancelled); return { id, type, status: cancelled.status };
    }
    if ([...jobs.values()].some(x => x.status === 'running')) throw new Error('진행 중인 작업을 완료하거나 취소한 뒤 다시 실행해 주세요.');
    const controller = new AbortController();
    const job = { id, type, mediaId: item.id, status: 'running', progress: 0, stage: '작업 준비', controller, createdAt: Date.now() };
    jobs.set(id, job);
    const options = { signal: controller.signal, progress: value => { if (job.status === 'running') Object.assign(job, value); }, preview: type === 'preview', range: ['preview', 'export'].includes(type) ? range : undefined, textMode: type === 'transcript' ? textMode : undefined, speechProtection, transcript, captionStyle, effects, effectAssets };
    job.task = Promise.resolve().then(async () => {
      const result = await executeMediaJob({ type, settings, trackIndex, cuts, range, speechProtection, transcription, transcript, captionStyle, effects, textMode }, item, directory, options);
      if (controller.signal.aborted) { if (result.path) await rm(result.path, { force: true }); job.status = 'cancelled'; return; }
      if (['export', 'preview', 'captions', 'transcript'].includes(type)) { exports.set(result.id, result); const { path: omitted, ...safe } = result; job.result = safe; }
      else job.result = result;
      job.status = 'completed'; job.progress = 1; job.stage = '완료';
    }).catch(error => { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; }).finally(() => { job.finishedAt = Date.now(); });
    return { id, type, status: job.status };
  }
  app.post('/api/jobs', asyncRoute(async (req, res) => {
    const { type, mediaId, settings, trackIndex, cuts, requestId, range, speechProtection, transcription, transcript, captionStyle, effects, textMode } = req.body;
    const item = findMedia(mediaId);
    validateMediaJob(req.body, item);
    res.status(202).json(startJob(type, item, settings, trackIndex, cuts, requestId, range, speechProtection, transcription, transcript, captionStyle, effects, textMode));
  }));
  app.get('/api/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });
    const { controller, task, ...safe } = job; res.json(safe);
  });
  app.delete('/api/jobs/:id', asyncRoute(async (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job && isRequestId(req.params.id)) {
      cancelledRequests.add(req.params.id);
      if (cancelledRequests.size > 256) cancelledRequests.delete(cancelledRequests.values().next().value);
    }
    if (job?.status === 'running') { job.stage = '취소 중'; job.controller.abort(); await job.task; }
    res.json({ cancelled: job?.status === 'cancelled' || cancelledRequests.has(req.params.id) });
  }));
  app.get('/api/exports/:id', (req, res) => {
    const output = exports.get(req.params.id);
    if (!output) return res.status(404).json({ error: '내보낸 파일을 찾을 수 없습니다.' });
    if (req.query.download) res.download(output.path, output.name, { dotfiles: 'allow' });
    else { res.type(output.mime || 'video/mp4'); res.sendFile(output.path, { dotfiles: 'allow' }); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '지원하지 않는 요청입니다.' }));
  app.use(express.static(distDir));
  app.use((req, res, next) => { if (req.method === 'GET') res.sendFile(path.join(distDir, 'index.html'), error => error && next(error)); else next(); });
  app.use((error, req, res, _next) => res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? (req.path === '/api/effects' ? '1 GB 이하의 효과음을 선택해 주세요.' : '20 GB 이하의 영상을 선택해 주세요.') : error.message || '작업 중 오류가 발생했습니다.' }));
  return {
    app, registerFile, registerEffect, directory, exports, media, effectAssets,
    async close() { shares.close(); const aiClosing = ai.close(); playbackController.abort(); for (const job of jobs.values()) job.controller?.abort(); await Promise.allSettled([aiClosing, ...effectImports, ...captionPreviews, ...[...jobs.values()].map(job => job.task), ...[...media.values()].flatMap(item => [...(item.playbacks?.values() || [])])]); /* Keep session files until the next explicit cleanup. */ },
  };
}

export async function startServer(options = {}) {
  const instance = await createApp(options);
  const http = await new Promise((resolve, reject) => { const server = instance.app.listen(options.port ?? 4327, '127.0.0.1', error => error ? reject(error) : resolve(server)); server.on('error', reject); });
  return { ...instance, url: `http://127.0.0.1:${http.address().port}`, async close() { await instance.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); } };
}
