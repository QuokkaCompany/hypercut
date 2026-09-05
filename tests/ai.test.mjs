import test from 'node:test';
import assert from 'node:assert/strict';
import { validateProposal, proposalPrompt } from '../shared/ai.mjs';
import { askAI, validateConnection } from '../server/ai.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';

const proposal = { settings: { ...DEFAULT_SETTINGS, thresholdDb: -45 }, explanation: '작은 목소리를 더 보존하도록 기준을 낮춥니다.' };
const json = JSON.stringify(proposal);
const config = provider => ({ provider, model: 'selected-model', apiKey: 'test-key-not-real' });

test('A03: accepts only complete settings proposals, rejects executable payloads and bounds', () => {
  assert.deepEqual(validateProposal(json), proposal);
  assert.deepEqual(validateProposal('```json\n'+json+'\n```'), proposal);
  for (const value of ['invalid json', { ...proposal, command: 'rm -rf' }, { settings: {}, explanation: 'no' }, { ...proposal, settings: { ...proposal.settings, thresholdDb: 5 } }, { ...proposal, settings: { ...proposal.settings, preRollMs: NaN } }, { ...proposal, explanation: 'x'.repeat(801) }]) assert.throws(() => validateProposal(value));
});
test('A06: prompt contains only explicit instruction/settings, strips extra context', () => {
  const text = proposalPrompt('Keep pauses', { ...DEFAULT_SETTINGS, mediaPath: '/private/video.mp4', apiKey: 'secret' });
  assert.ok(text.includes('Keep pauses')); assert.ok(!text.includes('/private/video')); assert.ok(!text.includes('secret'));
  assert.throws(() => proposalPrompt('', DEFAULT_SETTINGS));
});
test('A06: local connection rejects remote URLs, credentials and redirects; provider is explicit', () => {
  assert.equal(validateConnection(config('ollama')).baseURL, 'http://127.0.0.1:11434');
  for (const baseURL of ['https://evil.invalid', 'http://127.0.0.1.evil.invalid', 'http://user:password@localhost', 'file:///tmp/key', 'http://localhost/api', 'http://localhost?url=https://evil.invalid']) assert.throws(() => validateConnection({ ...config('ollama'), baseURL }));
  assert.throws(() => validateConnection({ ...config('unknown') }));
});
for (const provider of ['ollama', 'openai', 'anthropic']) test(`A02/A06: ${provider} request contract and JSON extraction (mock, no authenticated call)`, async () => {
  const result = await askAI(config(provider), 'Keep quiet speech', DEFAULT_SETTINGS, { fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'selected-model'); assert.equal(options.redirect, 'error');
    assert.ok(!options.body.includes('test-key-not-real')); assert.ok(!Object.hasOwn(body, 'tools'));
    if (provider === 'ollama') { assert.equal(url, 'http://127.0.0.1:11434/api/chat'); assert.equal(options.headers.Authorization, undefined); return Response.json({ done: true, message: { content: json } }); }
    if (provider === 'openai') { assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(body.store, false); assert.equal(body.text.format.strict, true); return Response.json({ status: 'completed', output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: json }] }] }); }
    assert.equal(url, 'https://api.anthropic.com/v1/messages'); assert.equal(body.output_config.format.type, 'json_schema'); return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: json }] });
  } });
  assert.deepEqual(result, proposal);
});
test('A04: status errors are distinct and provider bodies cannot leak secrets', async () => {
  for (const [status, message] of [[401, '인증'], [403, '권한'], [429, '한도'], [503, '서버 오류']]) {
    let count = 0;
    await assert.rejects(askAI(config('openai'), 'test', DEFAULT_SETTINGS, { fetchImpl: async () => { count++; return new Response('test-key-not-real', { status }); } }), e => e.message.includes(message) && !e.message.includes('test-key'));
    assert.equal(count, 1);
  }
});
test('A04: abort and timeout settle without fallback; incomplete output is rejected', async () => {
  const controller = new AbortController();
  const waitsForAbort = async (_url, options) => { await new Promise((_, reject) => { if (options.signal.aborted) reject(options.signal.reason); else options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }); }); };
  const pending = askAI(config('ollama'), 'test', DEFAULT_SETTINGS, { signal: controller.signal, fetchImpl: waitsForAbort }); controller.abort();
  await assert.rejects(pending, /취소/);
  const keepAlive = setTimeout(() => {}, 500);
  try { await assert.rejects(askAI(config('ollama'), 'test', DEFAULT_SETTINGS, { timeoutMs: 10, fetchImpl: waitsForAbort }), /시간이 초과/); } finally { clearTimeout(keepAlive); }
  await assert.rejects(askAI(config('openai'), 'test', DEFAULT_SETTINGS, { fetchImpl: async () => Response.json({ status: 'incomplete' }) }), /완료되지/);
});
