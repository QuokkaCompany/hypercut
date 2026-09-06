import { startServer } from '../server/app.mjs';
const server = await startServer({ port: 0, dataDir: process.env.HYPERCUT_BENCHMARK_DATA_DIR });
process.send?.({ url: server.url });
// Private parent IPC for diagnostics; no HTTP endpoint or forced collection.
process.on('message', message => {
  if (message?.type === 'memory-snapshot' && typeof message.id === 'string') process.send?.({ type: 'memory-snapshot', id: message.id, memory: process.memoryUsage() });
});
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
