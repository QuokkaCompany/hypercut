import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, rm, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { digest, requireValue } from './store.mjs';
import { inspectMedia, publicMedia } from '../media.mjs';
import { inspectEffect, publicEffect } from '../effects.mjs';

export const CHUNK_BYTES = 8 * 1024 ** 2;
export function installUploads(app, route, { store, quota, maxUpload, signal }) {
  const locks = new Set();
  const folder = id => path.join(store.directory, 'uploads', id);
  const safe = item => ({ id: item.id, name: item.name, size: item.size, kind: item.kind, offset: item.offset, hashes: item.hashes, chunkBytes: CHUNK_BYTES, result: item.result });
  const locked = fn => route(async (req, res) => {
    const key = req.params.id;
    requireValue(!locks.has(key), 409, 'Upload is busy. Retry this request.');
    locks.add(key); try { await fn(req, res); } finally { locks.delete(key); }
  });
  app.post('/api/uploads', route(async (req, res) => {
    const { name, size, kind = 'media' } = req.body;
    requireValue(typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[\x00-\x1f]/.test(name), 400, 'Invalid filename.');
    requireValue(['media', 'effect'].includes(kind) && Number.isSafeInteger(size) && size > 0 && size <= Math.min(maxUpload, kind === 'effect' ? 1024 ** 3 : maxUpload), 413, 'File exceeds the upload limit.');
    const upload = { id: randomUUID(), owner: req.session.owner, name: path.basename(name), size, kind, offset: 0, hashes: [], createdAt: Date.now() };
    store.transaction(() => {
      requireValue(store.usage(upload.owner) + size <= quota, 413, 'Account storage quota exceeded. Remove unused files first.');
      requireValue(store.list('upload', upload.owner).filter(x => !x.result).length < 8, 429, 'Too many incomplete uploads.');
      store.put('upload', upload, size);
    });
    res.status(201).json(safe(upload));
  }));
  app.get('/api/uploads', (req, res) => res.json(store.list('upload', req.session.owner).filter(x => !x.result).map(safe)));
  app.get('/api/uploads/:id', (req, res) => res.json(safe(store.need('upload', req.params.id, req.session.owner))));
  app.put('/api/uploads/:id/chunks/:offset', locked(async (req, res) => {
    const item = store.need('upload', req.params.id, req.session.owner), offset = Number(req.params.offset), bytes = req.body;
    requireValue(!item.result && Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= CHUNK_BYTES, 400, 'Invalid upload chunk.');
    requireValue(Number.isSafeInteger(offset) && offset >= 0 && offset % CHUNK_BYTES === 0, 400, 'Invalid chunk offset.');
    const hash = digest(bytes);
    requireValue(req.headers['x-content-sha256'] === hash, 400, 'Chunk digest mismatch.');
    if (offset < item.offset) { requireValue(item.hashes[offset / CHUNK_BYTES] === hash, 409, 'Previously uploaded chunk differs.'); res.json(safe(item)); return; }
    requireValue(offset === item.offset && bytes.length === Math.min(CHUNK_BYTES, item.size - offset), 409, 'Resume from the committed offset.');
    await mkdir(folder(item.id), { recursive: true, mode: 0o700 });
    const target = path.join(folder(item.id), String(offset)), temporary = `${target}.tmp`;
    // A chunk is committed only after its durable file exists. Orphaned files can be safely replaced on retry.
    const handle = await open(temporary, 'w', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, target);
    item.offset += bytes.length; item.hashes.push(hash); store.put('upload', item, item.size);
    res.json(safe(item));
  }));
  app.post('/api/uploads/:id/complete', locked(async (req, res) => {
    const item = store.need('upload', req.params.id, req.session.owner);
    if (item.result) { res.json(item.result); return; }
    requireValue(item.offset === item.size, 409, 'Upload is incomplete.');
    const target = path.join(folder(item.id), 'source'), handle = await open(target, 'w', 0o600);
    try {
      for (let offset = 0; offset < item.size; offset += CHUNK_BYTES) {
        signal.throwIfAborted();
        const bytes = await readFile(path.join(folder(item.id), String(offset)));
        requireValue(digest(bytes) === item.hashes[offset / CHUNK_BYTES], 409, 'Stored chunk is damaged. Restart the upload.');
        await handle.writeFile(bytes);
      }
      await handle.sync();
    } finally { await handle.close(); }
    let asset;
    try {
      const probe = await open(target, 'r'), header = Buffer.alloc(12);
      try { await probe.read(header, 0, 12, 0); } finally { await probe.close(); }
      const atom = header.toString('ascii', 4, 8), magic = header.toString('ascii', 0, 4);
      if (item.kind === 'media') {
        requireValue(['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(atom), 400, 'Upload an MP4 or MOV file, not a playlist or URL.');
        asset = await inspectMedia(target, item.name, signal, { inputFormat: 'mov' });
        requireValue(asset.duration <= 7200 && asset.width > 0 && asset.height > 0 && asset.width * asset.height <= 3840 * 2160 && asset.fps <= 120 && asset.audioTracks.length <= 32 && asset.audioTracks.every(x => x.channels <= 8), 400, 'Cloud beta supports up to two hours, 4K, 120 fps and eight audio channels.');
      } else {
        requireValue(magic === 'RIFF' || magic === 'fLaC' || magic === 'OggS' || ['ftyp', 'moov'].includes(atom) || header.toString('ascii', 0, 3) === 'ID3' || (header[0] === 255 && (header[1] & 0xe0) === 0xe0), 400, 'Upload WAV, FLAC, Ogg, MP3, AAC or M4A audio, not a playlist.');
        asset = await inspectEffect(target, item.name, signal);
      }
    }
    catch (error) { await rm(target, { force: true }); throw error; }
    const result = (item.kind === 'media' ? publicMedia : publicEffect)(asset);
    store.transaction(() => {
      store.put(item.kind, { ...asset, owner: item.owner }, item.size);
      store.put('upload', { ...item, result }, 0);
    });
    for (let offset = 0; offset < item.size; offset += CHUNK_BYTES) await rm(path.join(folder(item.id), String(offset)), { force: true });
    res.json(result);
  }));
  app.delete('/api/uploads/:id', locked(async (req, res) => {
    const item = store.need('upload', req.params.id, req.session.owner);
    requireValue(!item.result, 409, 'Completed uploads are managed in the media library.');
    await rm(folder(item.id), { recursive: true, force: true }); store.remove('upload', item.id, item.owner); res.json({ deleted: true });
  }));
}
