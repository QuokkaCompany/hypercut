import express from 'express';
import multer from 'multer';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectMedia, publicMedia, analyzeMedia, exportMedia, playbackFile, restoreMediaRange } from './media.mjs';
import { validateSettings } from '../shared/timeline.mjs';
import { capture } from './process.mjs';
import { installAIRoutes } from './ai.mjs';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export async function createApp({ dataDir = path.join(projectRoot, '.hypercut'), distDir = path.join(projectRoot, 'dist'), development = false, aiFetch } = {}) {
  const directory = path.join(dataDir, 'sessions', randomUUID());
  await mkdir(directory, { recursive: true });
  const token = randomBytes(32).toString('hex');
  const media = new Map(), jobs = new Map(), exports = new Map();
  const cancelledRequests = new Set();
  const isRequestId = id => typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
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
      if (req.path !== '/api/config' && (req.headers['x-hypercut-token'] || req.query.token) !== token) return res.status(401).json({ error: '앱 연결이 만료되었습니다. 새로고침해 주세요.' });
    }
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  const upload = multer({ dest: directory, limits: { fileSize: 20 * 1024 ** 3, files: 1, fields: 2 } });
  const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  const ai = installAIRoutes(app, asyncRoute, { fetchImpl: aiFetch });
  const findMedia = id => { const item = media.get(id); if (!item) throw new Error('원본 영상을 다시 불러와 주세요.'); return item; };
  const registerFile = async (filePath, name, signal = playbackController.signal) => { const item = await inspectMedia(filePath, name, signal); signal?.throwIfAborted(); media.set(item.id, item); return publicMedia(item); };
  let toolsStatus;
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
  app.get('/api/media/:id/file', asyncRoute(async (req, res) => {
    const item = findMedia(req.params.id);
    const trackIndex = req.query.trackIndex === undefined ? item.audioTracks[0]?.index : Number(req.query.trackIndex);
    const source = await playbackFile(item, trackIndex, directory, { signal: playbackController.signal });
    res.type('video/mp4'); res.sendFile(source, { dotfiles: 'allow' });
  }));
  function startJob(type, item, settings, trackIndex, cuts, requestedId, range) {
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
    const options = { signal: controller.signal, progress: value => { if (job.status === 'running') Object.assign(job, value); }, preview: type === 'preview', range: type === 'preview' ? range : undefined };
    job.task = Promise.resolve().then(async () => {
      const result = type === 'analyze' ? await analyzeMedia(item, settings, trackIndex, options) : type === 'restore' ? await restoreMediaRange(item, cuts, range, options) : await exportMedia(item, cuts, trackIndex, directory, options);
      if (controller.signal.aborted) { if (result.path) await rm(result.path, { force: true }); job.status = 'cancelled'; return; }
      if (['export', 'preview'].includes(type)) { exports.set(result.id, result); const { path: omitted, ...safe } = result; job.result = safe; }
      else job.result = result;
      job.status = 'completed'; job.progress = 1; job.stage = '완료';
    }).catch(error => { job.status = controller.signal.aborted ? 'cancelled' : 'failed'; job.error = error.message; }).finally(() => { job.finishedAt = Date.now(); });
    return { id, type, status: job.status };
  }
  app.post('/api/jobs', asyncRoute(async (req, res) => {
    const { type, mediaId, settings, trackIndex, cuts, requestId, range } = req.body;
    if (requestId !== undefined && !isRequestId(requestId)) throw new Error('작업 ID가 올바르지 않습니다.');
    if (!['analyze', 'export', 'preview', 'restore'].includes(type)) throw new Error('지원하지 않는 작업입니다.');
    const item = findMedia(mediaId);
    if (!Number.isInteger(trackIndex) || !item.audioTracks.some(x => x.index === trackIndex)) throw new Error('오디오 트랙을 선택해 주세요.');
    if (type === 'analyze') validateSettings(settings);
    else {
      if (!Array.isArray(cuts) || cuts.length > 50000) throw new Error('편집 구간이 올바르지 않습니다.');
      for (const x of cuts) if (typeof x.enabled !== 'boolean' || !Number.isFinite(x.start) || !Number.isFinite(x.end) || x.start < 0 || x.end > item.duration || x.end <= x.start) throw new Error('편집 구간이 영상 범위를 벗어났습니다.');
    }
    if (type === 'restore' && (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.start < 0 || range.end > item.duration || range.start >= range.end)) throw new Error('복원 범위가 올바르지 않습니다.');
    if (range !== undefined && !['restore', 'preview'].includes(type)) throw new Error('이 작업은 범위 지정을 지원하지 않습니다.');
    if (type === 'preview' && range !== undefined && (!Number.isFinite(range?.start) || !Number.isFinite(range?.end) || range.start < 0 || range.end > item.duration || range.start >= range.end)) throw new Error('미리보기 범위가 올바르지 않습니다.');
    res.status(202).json(startJob(type, item, settings, trackIndex, cuts, requestId, range));
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
    else { res.type('video/mp4'); res.sendFile(output.path, { dotfiles: 'allow' }); }
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: '지원하지 않는 요청입니다.' }));
  app.use(express.static(distDir));
  app.use((req, res, next) => { if (req.method === 'GET') res.sendFile(path.join(distDir, 'index.html'), error => error && next(error)); else next(); });
  app.use((error, _req, res, _next) => res.status(400).json({ error: error.code === 'LIMIT_FILE_SIZE' ? '20 GB 이하의 영상을 선택해 주세요.' : error.message || '작업 중 오류가 발생했습니다.' }));
  return {
    app, registerFile, directory, exports, media,
    async close() { ai.close(); playbackController.abort(); for (const job of jobs.values()) job.controller?.abort(); await Promise.allSettled([...jobs.values()].map(job => job.task).concat([...media.values()].flatMap(item => [...(item.playbacks?.values() || [])]))); /* Keep session files until the next explicit cleanup. */ },
  };
}

export async function startServer(options = {}) {
  const instance = await createApp(options);
  const http = await new Promise((resolve, reject) => { const server = instance.app.listen(options.port ?? 4327, '127.0.0.1', error => error ? reject(error) : resolve(server)); server.on('error', reject); });
  return { ...instance, url: `http://127.0.0.1:${http.address().port}`, async close() { await instance.close(); http.closeAllConnections(); await new Promise(resolve => http.close(resolve)); } };
}
