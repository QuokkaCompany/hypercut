import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { bridgeConfiguration, createMCPBridge } from './mcp-bridge.mjs';

let config;
try { config = bridgeConfiguration(process.env); }
catch { console.error('HyperCut 앱에서 발급한 MCP 연결 설정이 필요합니다.'); process.exit(1); }
// Capability is scoped to one share, never the editor's full API token.
delete process.env.HYPERCUT_MCP_CAPABILITY;
const controller = new AbortController(); let handle, stopping = false;
async function stop(code = 0) {
  if (stopping) return; stopping = true; controller.abort();
  await handle?.close().catch(() => {}); process.exit(code);
}
handle = serveStdio(() => createMCPBridge(config, { signal: controller.signal }), {
  transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 132 * 1024 }),
  maxSubscriptions: 0,
  onerror: () => { console.error('HyperCut MCP 메시지를 처리할 수 없습니다.'); void stop(1); },
});
process.stdin.once('end', () => void stop());
process.once('SIGINT', () => void stop(130));
process.once('SIGTERM', () => void stop(143));
