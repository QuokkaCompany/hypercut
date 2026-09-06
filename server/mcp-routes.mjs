import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createShareStore } from './mcp-shares.mjs';

const exchange = /^\/api\/mcp-exchange\/[0-9a-f-]{36}(?:\/proposals)?$/i;
export const isShareExchange = req => exchange.test(req.path) && ((req.method === 'GET' && !req.path.endsWith('/proposals')) || (req.method === 'POST' && req.path.endsWith('/proposals')));

export function installShareRoutes(app, { store = createShareStore() } = {}) {
  const wrap = fn => (req, res) => {
    try { res.json(fn(req)); }
    catch (error) { res.status(error.status || 400).json({ error: error.message, code: error.code || 'INVALID_SHARE_REQUEST' }); }
  };
  app.post('/api/ai/shares', wrap(req => {
    const share = store.create(req.body);
    const command = process.execPath;
    const script = fileURLToPath(new URL('./mcp-stdio.mjs', import.meta.url));
    return { ...share, connection: { command, args: [path.resolve(script)], env: {
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      HYPERCUT_MCP_URL: `http://127.0.0.1:${req.socket.localPort}`,
      HYPERCUT_MCP_SHARE: share.shareId,
      HYPERCUT_MCP_CAPABILITY: share.capability,
    } } };
  }));
  app.get('/api/ai/shares/:id', wrap(req => store.ownerRead(req.params.id)));
  app.post('/api/ai/shares/:id/resolution', wrap(req => store.resolve(req.params.id, req.body)));
  app.delete('/api/ai/shares/:id', wrap(req => store.revoke(req.params.id)));
  app.get('/api/mcp-exchange/:id', wrap(req => store.read(req.params.id, req.headers['x-hypercut-share-capability'])));
  app.post('/api/mcp-exchange/:id/proposals', wrap(req => store.submit(req.params.id, req.headers['x-hypercut-share-capability'], req.body)));
  app.use(['/api/ai/shares', '/api/mcp-exchange'], (error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ error: '공유 요청은 128 KiB 이하의 올바른 JSON이어야 합니다.', code: 'INVALID_SHARE_BODY' }));
  const timer = setInterval(() => store.sweep(), 15_000); timer.unref();
  return { close() { clearInterval(timer); store.close(); } };
}
