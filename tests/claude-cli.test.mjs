import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { createClaudeCLI, cliEnvironment } from '../server/claude-cli.mjs';
import { validateConnection } from '../server/ai.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';

const help = '--safe-mode --tools --strict-mcp-config --mcp-config --no-session-persistence --json-schema --output-format --setting-sources --system-prompt --permission-mode --permission-prompts';
const proposal = { settings: { ...DEFAULT_SETTINGS, minSilenceMs: 700 }, explanation: '긴 무음만 줄입니다.' };
const success = { type: 'result', subtype: 'success', is_error: false, structured_output: proposal, usage: { input_tokens: 123, output_tokens: 45 }, modelUsage: { 'claude-test-model': {} }, session_id: 'private-session', result: 'private-provider-text' };
function stub({ auth, output = success, helpText = help, onRequest } = {}) {
  return async (_executable, args, options) => {
    assert.deepEqual(await readdir(options.cwd), []);
    if (args.includes('--version')) return { code: 0, stdout: '2.1.260 (Claude Code)' };
    if (args.includes('--help')) return { code: 0, stdout: helpText };
    if (args.includes('auth')) return { code: 0, stdout: JSON.stringify(auth || { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'firstParty', email: 'private@example.invalid' }) };
    await onRequest?.(args, options);
    return { code: 0, stdout: typeof output === 'string' ? output : JSON.stringify(output) };
  };
}

test('A06: CLI configuration discards keys and child environment excludes auth/provider overrides', () => {
  assert.deepEqual(validateConnection({ provider: 'claude_cli', model: 'sonnet', apiKey: 'never-use', command: 'anything' }), { provider: 'claude_cli', model: 'sonnet' });
  assert.throws(() => validateConnection({ provider: 'claude_cli', model: '--help' }));
  const env = cliEnvironment({ HOME: '/original-home', PATH: '/bin', ANTHROPIC_API_KEY: 'api-secret', ANTHROPIC_AUTH_TOKEN: 'other-secret', CLAUDE_CODE_OAUTH_TOKEN: 'token', ANTHROPIC_BASE_URL: 'https://wrong.invalid', NODE_OPTIONS: '--import=bad', HTTPS_PROXY: 'secret-proxy' });
  assert.equal(env.HOME, '/original-home'); assert.equal(env.PATH, '/bin');
  assert.ok(!JSON.stringify(env).includes('secret')); assert.equal(env.NODE_OPTIONS, undefined); assert.equal(env.ANTHROPIC_BASE_URL, undefined);
});

test('A02/A06: CLI proposal uses selected model, stdin and no tools; receipt strips private metadata', async () => {
  const cli = createClaudeCLI({ executable: process.execPath, runner: stub({ onRequest: (args, options) => {
    assert.equal(args[args.indexOf('--model') + 1], 'sonnet'); assert.equal(args[args.indexOf('--tools') + 1], '');
    assert.equal(args[args.indexOf('--mcp-config') + 1], '{"mcpServers":{}}'); assert.ok(args.includes('--strict-mcp-config'));
    assert.ok(args.includes('--safe-mode')); assert.ok(args.includes('--no-session-persistence'));
    assert.equal(args[args.indexOf('--setting-sources') + 1], ''); assert.equal(args[args.indexOf('--permission-prompts') + 1], 'none');
    assert.ok(!args.includes('--dangerously-skip-permissions')); assert.ok(!args.join(' ').includes('unique instruction'));
    assert.ok(options.input.includes('unique instruction')); assert.ok(!options.input.includes('private.mp4'));
  } }) });
  const status = await cli.check(); assert.equal(status.ready, true); assert.ok(!JSON.stringify(status).includes('private@'));
  const result = await cli.ask('sonnet', 'unique instruction', { ...DEFAULT_SETTINGS, filename: 'private.mp4' });
  assert.deepEqual(result.proposal, proposal); assert.equal(result.execution.inputTokens, 123); assert.equal(result.execution.outputTokens, 45);
  assert.deepEqual(result.execution.models, ['claude-test-model']); assert.ok(!JSON.stringify(result).includes('private-'));
});

test('A01/A07: missing or incompatible CLI and non-subscription auth cannot issue a model request', async () => {
  const missing = createClaudeCLI({ executable: '/nonexistent/hypercut-test-cli' }); assert.equal((await missing.check()).installed, false);
  let requests = 0;
  for (const options of [{ helpText: '--tools' }, { auth: { loggedIn: false, authMethod: 'none' } }, { auth: { loggedIn: true, authMethod: 'api_key', apiProvider: 'firstParty' } }, { auth: { loggedIn: true, authMethod: 'claude.ai', apiProvider: 'bedrock' } }]) {
    const cli = createClaudeCLI({ executable: process.execPath, runner: stub({ ...options, onRequest: () => requests++ }) });
    assert.equal((await cli.check()).ready, false); await assert.rejects(cli.ask('sonnet', 'test', DEFAULT_SETTINGS));
  }
  assert.equal(requests, 0);
});

test('A03/A04: malformed, incomplete and out-of-range CLI output is rejected without raw diagnostics', async () => {
  for (const output of ['bad-private-provider-output', { ...success, subtype: 'error_during_execution', is_error: true }, { ...success, structured_output: { ...proposal, command: 'rm' } }, { ...success, structured_output: { ...proposal, settings: { ...proposal.settings, thresholdDb: 2 } } }, { ...success, structured_output: undefined }]) {
    const cli = createClaudeCLI({ executable: process.execPath, runner: stub({ output }) });
    await assert.rejects(cli.ask('sonnet', 'test', DEFAULT_SETTINGS), e => !e.message.includes('private'));
  }
});
