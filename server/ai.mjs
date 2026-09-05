import { PROPOSAL_SCHEMA, proposalPrompt, validateProposal } from '../shared/ai.mjs';
import { createClaudeCLI } from './claude-cli.mjs';

const HTTP_ERRORS = { 401: '인증에 실패했습니다. API 키를 확인해 주세요.', 403: '이 모델을 사용할 권한이 없습니다.', 429: '사용량 또는 요청 한도에 도달했습니다.' };

export function validateConnection(input) {
  if (!['ollama', 'openai', 'anthropic', 'claude_cli'].includes(input?.provider)) throw new Error('지원하지 않는 AI 연결입니다.');
  const model = input.model?.trim();
  if (!model || model.length > 200 || /[\r\n]/.test(model)) throw new Error('사용할 모델 이름을 입력해 주세요.');
  if (input.provider === 'claude_cli') {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(model)) throw new Error('Claude Code 모델 이름이 올바르지 않습니다.');
    return { provider: 'claude_cli', model };
  }
  if (input.provider === 'ollama') {
    let url;
    try { url = new URL(input.baseURL || 'http://127.0.0.1:11434'); } catch { throw new Error('Ollama 주소가 올바르지 않습니다.'); }
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Ollama는 이 컴퓨터의 HTTP 주소만 연결할 수 있습니다.');
    return { provider: 'ollama', model, baseURL: url.origin };
  }
  if (typeof input.apiKey !== 'string' || !input.apiKey.trim() || input.apiKey.length > 1000 || /[\r\n]/.test(input.apiKey)) throw new Error('API 키를 입력해 주세요.');
  return { provider: input.provider, model, apiKey: input.apiKey.trim() };
}

async function readJSON(response) {
  if (!response.ok) { await response.body?.cancel(); throw new Error(HTTP_ERRORS[response.status] || (response.status >= 500 ? 'AI 서버 오류입니다. 잠시 뒤 다시 시도해 주세요.' : `AI 요청이 거부되었습니다 (HTTP ${response.status}). 모델 이름과 지원 형식을 확인해 주세요.`)); }
  const reader = response.body.getReader(); const parts = []; let size = 0;
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 256 * 1024) throw new Error('AI 응답 크기가 제한을 넘었습니다.'); parts.push(value); }
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); }
}

export async function askAI(connection, instruction, settings, { signal, fetchImpl = fetch, timeoutMs = 90000, claudeCLI = createClaudeCLI(), onExecution } = {}) {
  const prompt = proposalPrompt(instruction, settings);
  const config = validateConnection(connection);
  if (config.provider === 'claude_cli') {
    const result = await claudeCLI.ask(config.model, instruction, settings, { signal, timeoutMs });
    onExecution?.(result.execution); return result.proposal;
  }
  const messages = [{ role: 'user', content: prompt }];
  let url, headers = { 'Content-Type': 'application/json' }, body;
  if (config.provider === 'ollama') {
    url = `${config.baseURL}/api/chat`;
    body = { model: config.model, messages, stream: false, format: PROPOSAL_SCHEMA, options: { temperature: 0 } };
  } else if (config.provider === 'openai') {
    url = 'https://api.openai.com/v1/responses'; headers.Authorization = `Bearer ${config.apiKey}`;
    body = { model: config.model, input: messages, store: false, max_output_tokens: 2048, text: { format: { type: 'json_schema', name: 'silence_settings', strict: true, schema: PROPOSAL_SCHEMA } } };
  } else {
    url = 'https://api.anthropic.com/v1/messages'; headers['x-api-key'] = config.apiKey; headers['anthropic-version'] = '2023-06-01';
    body = { model: config.model, messages, max_tokens: 1024, output_config: { format: { type: 'json_schema', schema: PROPOSAL_SCHEMA } } };
  }
  const combined = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]);
  try {
    const data = await readJSON(await fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: combined, redirect: 'error' }));
    combined.throwIfAborted();
    let answer;
    if (config.provider === 'ollama') { if (data.done !== true) throw new Error('AI 응답이 완료되지 않았습니다.'); answer = data.message?.content; }
    else if (config.provider === 'openai') {
      if (data.status !== 'completed') throw new Error('AI 응답이 완료되지 않았습니다. 요청을 더 짧게 작성해 주세요.');
      const content = (data.output || []).flatMap(item => item.content || []);
      if (content.some(item => item.type === 'refusal')) throw new Error('AI가 이 요청에 대한 제안을 거절했습니다.');
      answer = content.filter(item => item.type === 'output_text').map(item => item.text).join('');
    } else { if (data.stop_reason !== 'end_turn') throw new Error('AI 응답이 완료되지 않았습니다.'); answer = (data.content || []).filter(item => item.type === 'text').map(item => item.text).join(''); }
    return validateProposal(answer);
  } catch (error) {
    if (signal?.aborted) throw new Error('AI 요청을 취소했습니다.');
    if (combined.aborted) throw new Error('AI 응답 시간이 초과됐습니다.');
    // Never relay raw provider bodies, transport errors or keys to the renderer/logs.
    if (error instanceof SyntaxError) throw new Error('AI가 올바른 JSON을 반환하지 않았습니다.');
    if (error instanceof TypeError) throw new Error('AI 서버에 연결할 수 없습니다. 연결 주소와 실행 상태를 확인해 주세요.');
    throw error;
  }
}

export function installAIRoutes(app, asyncRoute, { fetchImpl, claudeCLI = createClaudeCLI() } = {}) {
  let connection = null, active = null, generation = 0, verified = false, lastExecution = null;
  const lifecycle = new AbortController();
  const pending = new Set();
  const track = promise => { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };
  const disconnect = () => { generation++; active?.abort(); connection = null; verified = false; lastExecution = null; };
  app.get('/api/ai/claude/status', asyncRoute(async (_req, res) => res.json(await track(claudeCLI.check({ signal: lifecycle.signal })))));
  app.get('/api/ai/connection', (_req, res) => res.json(connection ? { connected: true, provider: connection.provider, model: connection.model, baseURL: connection.baseURL, verified, lastExecution } : { connected: false }));
  app.post('/api/ai/connection', (req, res) => { const next = validateConnection(req.body); disconnect(); connection = next; res.json({ connected: true, provider: next.provider, model: next.model }); });
  app.delete('/api/ai/connection', (_req, res) => { disconnect(); res.json({ connected: false }); });
  app.delete('/api/ai/proposal', (_req, res) => { generation++; active?.abort(); res.json({ cancelled: true }); });
  app.post('/api/ai/proposal', asyncRoute(async (req, res) => {
    if (!connection) throw new Error('AI를 먼저 연결해 주세요.');
    if (active) throw new Error('진행 중인 AI 요청을 취소하거나 완료한 뒤 다시 요청해 주세요.');
    const controller = new AbortController(), revision = generation; active = controller;
    verified = false; lastExecution = null;
    const onClose = () => { if (!res.writableEnded) controller.abort(); }; res.on('close', onClose);
    try {
      let execution = null;
      const proposal = await track(askAI(connection, req.body.instruction, req.body.settings, { signal: AbortSignal.any([controller.signal, lifecycle.signal]), fetchImpl, claudeCLI, onExecution: value => { execution = value; } }));
      if (revision !== generation) throw new Error('연결이 변경되어 이전 AI 제안을 폐기했습니다.');
      verified = true; lastExecution = execution;
      res.json(proposal);
    } finally { res.off('close', onClose); if (active === controller) active = null; }
  }));
  return { async close() { lifecycle.abort(); disconnect(); await Promise.allSettled([...pending]); } };
}
