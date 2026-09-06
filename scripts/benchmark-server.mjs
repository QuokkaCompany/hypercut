import { startServer } from '../server/app.mjs';
const server = await startServer({ port: 0, dataDir: process.env.HYPERCUT_BENCHMARK_DATA_DIR });
process.send?.({ url: server.url });
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
