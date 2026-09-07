import { spawn } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PROPOSAL_SCHEMA, proposalPrompt, validateProposal } from '../../../shared/ai.mjs';

const REQUIRED_FLAGS = ['--safe-mode', '--tools', '--strict-mcp-config', '--mcp-config', '--no-session-persistence', '--json-schema', '--output-format', '--setting-sources', '--system-prompt', '--permission-mode', '--permission-prompts'];
const MESSAGES = {
  CLI_MISSING: 'Claude Code를 찾을 수 없습니다. 설치 후 다시 확인해 주세요.',
  CLI_VERSION: '이 Claude Code 버전은 필요한 연결 옵션을 지원하지 않습니다. 업데이트 후 다시 확인해 주세요.',
  CLI_AUTH: 'Claude Code의 구독 로그인이 필요합니다. 터미널에서 claude auth login을 실행한 뒤 다시 확인해 주세요.',
  CLI_TIMEOUT: 'Claude Code 응답 시간이 초과됐습니다.',
  CLI_CANCELLED: 'AI 요청을 취소했습니다.',
  CLI_OUTPUT: 'Claude Code 응답이 올바르지 않거나 크기 제한을 넘었습니다.',
  CLI_FAILED: 'Claude Code 요청을 완료하지 못했습니다. 로그인·모델·사용량 상태를 확인해 주세요.',
  CLI_LIMIT: 'Claude Code 사용량 또는 요청 한도에 도달했습니다.',
};
function failure(code) { return Object.assign(new Error(MESSAGES[code]), { code }); }

export function cliEnvironment(source = process.env) {
  // Use the CLI's existing login, never inherited API keys, proxy credentials,
  // NODE_OPTIONS or provider overrides. HOME itself is preserved, not reassigned.
  const result = {};
  for (const key of ['HOME', 'PATH', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT', 'WINDIR', 'APPDATA', 'LOCALAPPDATA']) if (source[key]) result[key] = source[key];
  return { ...result, NO_COLOR: '1', CI: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' };
}

async function findExecutable(override) {
  const candidates = override ? [override] : [process.env.CLAUDE_CLI_PATH, path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...(process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, 'claude'))];
  for (const candidate of candidates) if (candidate && path.isAbsolute(candidate)) {
    try { await access(candidate, constants.X_OK); return candidate; } catch { /* Try another installed location. */ }
  }
  throw failure('CLI_MISSING');
}

export function runCLI(executable, args, { input = '', cwd, signal, timeoutMs = 10000 } = {}) {
  if (signal?.aborted) return Promise.reject(failure('CLI_CANCELLED'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env: cliEnvironment(), shell: false, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const chunks = []; let bytes = 0, stopped, forceTimer;
    const kill = sig => { try { if (process.platform === 'win32') child.kill(sig); else if (child.pid) process.kill(-child.pid, sig); } catch { /* Already exited. */ } };
    const stop = code => { if (stopped) return; stopped = failure(code); kill('SIGTERM'); forceTimer = setTimeout(() => kill('SIGKILL'), 1000); };
    const timer = setTimeout(() => stop('CLI_TIMEOUT'), timeoutMs);
    const abort = () => stop('CLI_CANCELLED'); signal?.addEventListener('abort', abort, { once: true });
    const cleanup = () => { clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort); };
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024) stop('CLI_OUTPUT'); else chunks.push(chunk); });
    // Consume stderr, but never expose provider diagnostics, credentials or paths.
    child.stderr.on('data', chunk => { bytes += chunk.length; if (bytes > 256 * 1024) stop('CLI_OUTPUT'); });
    child.stdin.on('error', () => {});
    child.on('error', error => { cleanup(); reject(failure(error.code === 'ENOENT' ? 'CLI_MISSING' : 'CLI_FAILED')); });
    child.on('close', (code, exitSignal) => { if (stopped) kill('SIGKILL'); cleanup(); if (stopped) reject(stopped); else resolve({ stdout: Buffer.concat(chunks).toString('utf8'), code, signal: exitSignal }); });
    child.stdin.end(input);
  });
}

function jsonOutput(result) { try { return JSON.parse(result.stdout); } catch { throw failure('CLI_OUTPUT'); } }

export function createClaudeCLI({ executable: override, runner = runCLI } = {}) {
  async function check({ signal } = {}) {
    let executable;
    try { executable = await findExecutable(override); } catch { return { installed: false, compatible: false, loggedIn: false, ready: false, error: MESSAGES.CLI_MISSING }; }
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-claude-check-'));
    try {
      const versionResult = await runner(executable, ['--version'], { cwd: directory, signal });
      const version = versionResult.stdout.match(/\b\d+\.\d+\.\d+\b/)?.[0];
      const help = await runner(executable, ['--help'], { cwd: directory, signal });
      if (versionResult.code !== 0 || help.code !== 0 || !REQUIRED_FLAGS.every(flag => help.stdout.includes(flag))) return { installed: true, compatible: false, version, loggedIn: false, ready: false, error: MESSAGES.CLI_VERSION };
      const auth = await runner(executable, ['--safe-mode', 'auth', 'status'], { cwd: directory, signal });
      const data = jsonOutput(auth);
      const loggedIn = data.loggedIn === true && data.authMethod === 'claude.ai' && data.apiProvider === 'firstParty' && auth.code === 0;
      return { installed: true, compatible: true, version, loggedIn, ready: loggedIn, ...(loggedIn ? {} : { error: MESSAGES.CLI_AUTH }) };
    } catch (error) {
      if (signal?.aborted) throw failure('CLI_CANCELLED');
      return { installed: true, compatible: false, loggedIn: false, ready: false, error: MESSAGES[error.code] || MESSAGES.CLI_FAILED };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  async function askTask(model, { prompt, schema, validate, systemPrompt }, { signal, timeoutMs = 90000 } = {}) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(model)) throw new Error('Claude Code 모델 이름이 올바르지 않습니다.');
    const status = await check({ signal });
    if (!status.ready) throw new Error(status.error);
    const executable = await findExecutable(override);
    const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-claude-request-'));
    try {
      const args = ['--safe-mode', '--print', '--output-format', 'json', '--json-schema', JSON.stringify(schema), '--model', model,
        '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence', '--setting-sources', '',
        '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--system-prompt', systemPrompt];
      const result = await runner(executable, args, { cwd: directory, input: prompt, signal, timeoutMs });
      signal?.throwIfAborted();
      const data = jsonOutput(result);
      if (result.code !== 0 || data.type !== 'result' || data.subtype !== 'success' || data.is_error !== false) {
        if (/rate.?limit|usage.?limit|overloaded/i.test(String(data.result || '') + String(data.subtype || ''))) throw failure('CLI_LIMIT');
        throw failure('CLI_FAILED');
      }
      let proposal;
      try { proposal = validate(data.structured_output); } catch { throw failure('CLI_OUTPUT'); }
      const number = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
      const models = Object.keys(data.modelUsage || {}).filter(name => /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(name)).slice(0, 4);
      return { proposal, execution: { provider: 'claude_cli', requestedModel: model, models, at: new Date().toISOString(), inputTokens: number(data.usage?.input_tokens), outputTokens: number(data.usage?.output_tokens), cacheReadTokens: number(data.usage?.cache_read_input_tokens), cacheWriteTokens: number(data.usage?.cache_creation_input_tokens) } };
    } finally { await rm(directory, { recursive: true, force: true }); }
  }
  const ask = async (model, instruction, settings, options) => askTask(model, { prompt: proposalPrompt(instruction, settings), schema: PROPOSAL_SCHEMA, validate: validateProposal, systemPrompt: 'Return only the requested HyperCut settings proposal. No tools or file access. You have no audio or video.' }, options);
  return { check, ask, askTask };
}
