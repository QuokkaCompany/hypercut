import path from 'node:path';
import { startCloudServer } from './app.mjs';
const port = Number(process.env.PORT || 4328);
const server = await startCloudServer({ port, host: process.env.HYPERCUT_CLOUD_HOST || '127.0.0.1', publicURL: process.env.HYPERCUT_PUBLIC_URL || `http://127.0.0.1:${port}`, dataDir: path.resolve(process.env.HYPERCUT_CLOUD_DATA || '.hypercut/cloud'), quota: Number(process.env.HYPERCUT_CLOUD_QUOTA_BYTES || 10 * 1024 ** 3), maxUpload: Number(process.env.HYPERCUT_CLOUD_MAX_UPLOAD_BYTES || 2 * 1024 ** 3) });
console.log(`HyperCut cloud API ready at ${process.env.HYPERCUT_PUBLIC_URL || server.url}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close().then(() => process.exit()));
