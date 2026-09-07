import { startServer } from './app.mjs';
const server = await startServer({ port: Number(process.env.PORT || 4327), development: process.env.NODE_ENV === 'development' });
console.log(`HyperCut 준비 완료: ${server.url}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
