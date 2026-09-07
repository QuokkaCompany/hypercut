import test from 'node:test';
import assert from 'node:assert/strict';
import { effectProposalFixture } from './helpers/effect-proposal-fixture.mjs';
import { effectPrompt, validateEffectRequest, validateEffectProposal, buildEffectScope, applyEffectProposal, effectOutput } from '../shared/effect-proposal.mjs';
import { askEffectProposal } from './reference/server/ai.mjs';
test('FX04: only selected aliases, descriptions, clip values and optional captions reach the prompt', () => {
  const { input } = effectProposalFixture();
  const prompt = effectPrompt({ ...input, mediaPath: '/private/video.mp4', apiKey: 'test-secret', assets: input.assets.map(a => ({ ...a, path: '/private/audio.wav', fingerprint: 'a'.repeat(64), name: 'private-filename-one.wav' })), cues: input.cues.map(c => ({ ...c, reviewedFor: 'private-review' })) });
  for (const word of ['/private', 'private-', 'local-media-id', '보내지 않을', 'test-secret', 'a'.repeat(64)]) assert.ok(!prompt.includes(word), word);
  assert.ok(prompt.includes('짧은 알림음')); assert.ok(prompt.includes('여기를 강조합니다.')); assert.ok(prompt.includes('"start":5'));
  const clean = validateEffectRequest(input); assert.deepEqual(clean.clips, input.clips);
  for (const change of [{ assets: [] }, { clips: [...input.clips, input.clips[0]] }, { kept: [{ start: 2, end: 3 }, { start: 1, end: 4 }] }, { cues: input.cues.map(c => ({ ...c, end: 9 })) }, { duration: Infinity }, { assets: input.assets.map(a => ({ ...a, id: 'private-file' })) }]) assert.throws(() => validateEffectRequest({ ...input, ...change }));
});
test('FX04: add/update/remove selection is atomic, preserves unselected clips and refuses stale/repeated apply', () => {
  const { state, scope, input, proposal } = effectProposalFixture(), original = structuredClone(state);
  const next = applyEffectProposal(state, scope, input, proposal, ['clip-1', 'new-1']);
  assert.equal(next.clips.length, 4); assert.deepEqual(next.clips[0], { ...state.effects.clips[0], start: 5, duration: .4, gainDb: -6 }); assert.deepEqual(next.clips.slice(1, 3), state.effects.clips.slice(1));
  assert.equal(next.clips[3].id, `${input.requestId}-new-1`); assert.equal(next.clips[3].assetId, state.effects.assets[0].id); assert.equal(next.clips[3].start, 6.5); assert.equal(next.clips[3].offset, .1);
  assert.deepEqual(state, original); assert.throws(() => applyEffectProposal({ ...state, effects: next }, scope, input, proposal, ['new-1']), /변경/);
  const removed = applyEffectProposal(state, scope, input, proposal, ['clip-2']); assert.deepEqual(removed.clips.map(c => c.id), ['local-a', 'private-outside']);
  for (const changed of [{ ...state, contextId: 'another-media-id:1' }, { ...state, contextId: 'local-media-id:2' }, { ...state, kept: [{ start: 0, end: 8 }] }, { ...state, duration: 9 }, { ...state, cues: [] }, { ...state, effects: { ...state.effects, assets: state.effects.assets.slice(0, 1) } }]) assert.throws(() => applyEffectProposal(changed, scope, input, proposal, ['clip-1']), /변경/);
  assert.throws(() => applyEffectProposal(state, scope, { ...input, kept: [] }, proposal, ['clip-1']), /변경/);
  for (const ids of [[], ['unknown'], ['clip-1', 'clip-1']]) assert.throws(() => applyEffectProposal(state, scope, input, proposal, ids), /선택/);
});
test('FX04: reject unknown assets/targets, duplicate target, wrong nonce/before, invalid numbers and action shapes', () => {
  const { input, proposal } = effectProposalFixture(), update = proposal.changes[0], add = proposal.changes[2];
  assert.deepEqual(validateEffectProposal(JSON.stringify(proposal), input), proposal);
  for (const invalid of [
    { ...proposal, requestId: 'old' }, { ...proposal, command: 'execute' }, { ...proposal, changes: [update, update] },
    ...[{ ...update, id: 'clip-32' }, { ...update, before: { ...update.before, gainDb: -11 } }, { ...update, after: { ...update.after, start: 8 } }, { ...update, after: { ...update.after, duration: NaN } }, { ...update, after: { ...update.after, gainDb: 13 } }, { ...update, after: { ...update.after, offset: 3 } }, { ...update, after: { ...update.after, muted: 'yes' } }, { ...update, after: { ...update.after, assetId: 'asset-2' } }, { ...update, after: { ...update.after, command: 'run' } }, { ...update, after: update.before }, { ...add, before: update.before }, { ...add, id: 'new-21' }, { ...add, action: 'run' }, { ...proposal.changes[1], after: update.after }].map(change => ({ ...proposal, changes: [change] })),
  ]) assert.throws(() => validateEffectProposal(invalid, input));
});
test('FX04: bounded selection, caption privacy and output review retain deleted anchors and truncate tails', () => {
  const { state, input } = effectProposalFixture();
  for (const selection of [{ assetIds: [], clipIds: ['local-a'], cueIds: [], descriptions: {} }, { assetIds: [state.effects.assets[0].id], clipIds: ['private-outside'], cueIds: [], descriptions: {} }, { assetIds: [state.effects.assets[0].id], clipIds: [], cueIds: ['missing'], descriptions: {} }]) assert.throws(() => buildEffectScope(state, selection));
  const plain = buildEffectScope(state, { assetIds: [state.effects.assets[0].id], clipIds: [], cueIds: [], descriptions: {} }); assert.deepEqual(plain.context.cues, []); assert.deepEqual(plain.context.clips, []); assert.equal(plain.context.assets[0].description, '효과음 1');
  assert.equal(effectOutput({ ...input.clips[0], start: 3 }, input), null);
  const out = effectOutput({ ...input.clips[0], start: 7.8, duration: 2 }, input); assert.ok(Math.abs(out.duration - .2) < 1e-8); assert.ok(Math.abs(out.start - 5.8) < 1e-8);
  assert.throws(() => validateEffectRequest({ ...input, cues: [1, 2, 3].map((v, i) => ({ id: `cue-${v}`, start: i, end: i + .5, text: '가'.repeat(2000) })) }), /4,000/);
});
for (const provider of ['ollama', 'openai', 'anthropic']) test(`FX04: ${provider} schema/model/request contract (mock)`, async () => {
  const { input, proposal } = effectProposalFixture(); let calls = 0;
  const answer = await askEffectProposal({ provider, model: 'chosen-model', apiKey: 'test-secret' }, input, { fetchImpl: async (url, options) => {
    calls++; const body = JSON.parse(options.body); assert.equal(body.model, 'chosen-model'); assert.equal(options.redirect, 'error'); assert.equal(body.tools, undefined); assert.ok(!options.body.includes('private-filename')); assert.ok(!options.body.includes('test-secret'));
    const schema = provider === 'ollama' ? body.format : provider === 'openai' ? body.text.format.schema : body.output_config.format.schema; assert.equal(schema.properties.changes.items.properties.action.enum.length, 3); assert.equal(schema.additionalProperties, false);
    if (provider === 'ollama') { assert.equal(body.options.num_predict, 16384); assert.equal(url, 'http://127.0.0.1:11434/api/chat'); return Response.json({ done: true, message: { content: JSON.stringify(proposal) } }); }
    if (provider === 'openai') { assert.equal(body.store, false); assert.equal(body.text.format.name, 'sound_effects'); return Response.json({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(proposal) }] }] }); }
    return Response.json({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(proposal) }] });
  } }); assert.deepEqual(answer, proposal); assert.equal(calls, 1);
});
test('FX04: invalid selection has no model call, provider failure never falls back', async () => {
  const { input } = effectProposalFixture(); let calls = 0; const fetchImpl = async () => { calls++; return new Response('private-error', { status: 429 }); };
  await assert.rejects(askEffectProposal({ provider: 'openai', model: 'model', apiKey: 'key' }, { ...input, assets: [] }, { fetchImpl })); assert.equal(calls, 0);
  await assert.rejects(askEffectProposal({ provider: 'openai', model: 'model', apiKey: 'key' }, input, { fetchImpl }), /한도/); assert.equal(calls, 1);
});
