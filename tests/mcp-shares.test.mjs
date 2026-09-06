import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createShareStore, SHARE_LIMITS } from '../server/mcp-shares.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { effectProposalFixture } from './helpers/effect-proposal-fixture.mjs';

const settings = () => ({ task: 'settings', request: { instruction: '작은 목소리를 보존해 주세요.', settings: { ...DEFAULT_SETTINGS } } });
const suggestion = () => ({ settings: { ...DEFAULT_SETTINGS, thresholdDb: -48 }, explanation: '작은 목소리를 더 보존합니다.' });
const submission = (s, proposal = suggestion()) => ({ contextVersion: s.contextVersion, proposalId: randomUUID(), proposal });
const unavailable = fn => assert.throws(fn, e => e.code === 'SHARE_UNAVAILABLE');

test('shared snapshot is immutable and strips unselected metadata', () => {
  const store = createShareStore(), input = settings();
  input.request.filename = 'PRIVATE.mp4'; input.request.settings.secret = 'SECRET';
  const s = store.create(input); input.request.settings.thresholdDb = 0;
  const result = store.read(s.shareId, s.capability);
  assert.equal(result.context.request.settings.thresholdDb, DEFAULT_SETTINGS.thresholdDb);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|capability/);
  result.context.request.settings.thresholdDb = 0;
  assert.equal(store.read(s.shareId, s.capability).context.request.settings.thresholdDb, DEFAULT_SETTINGS.thresholdDb);
  assert.equal(store.ownerRead(s.shareId).proposal, null);
});

test('separate capabilities cannot read or submit to another share', () => {
  const store = createShareStore(), a = store.create(settings()), b = store.create(settings());
  for (const capability of [undefined, '', 'x'.repeat(64), b.capability]) {
    assert.throws(() => store.read(a.shareId, capability), e => e.code === 'SHARE_UNAUTHORIZED');
    assert.throws(() => store.submit(a.shareId, capability, submission(a)), e => e.code === 'SHARE_UNAUTHORIZED');
  }
  unavailable(() => store.read(randomUUID(), a.capability));
});

test('settings proposal queues once; only app acknowledgement records actual application', () => {
  const store = createShareStore(), s = store.create(settings()), value = submission(s);
  assert.equal(store.submit(s.shareId, s.capability, value).status, 'proposed');
  value.proposal.settings.thresholdDb = 0;
  assert.equal(store.ownerRead(s.shareId).proposal.settings.thresholdDb, -48);
  const retry = { ...value, proposal: suggestion() };
  assert.equal(store.submit(s.shareId, s.capability, retry).status, 'proposed');
  assert.throws(() => store.submit(s.shareId, s.capability, value), e => e.code === 'PROPOSAL_CONFLICT');
  assert.throws(() => store.submit(s.shareId, s.capability, submission(s)), e => e.code === 'PROPOSAL_CONFLICT');
  const resolution = { contextVersion: s.contextVersion, proposalId: value.proposalId, outcome: 'applied', selectedIds: ['settings'] };
  assert.equal(store.resolve(s.shareId, resolution).status, 'applied');
  assert.equal(store.resolve(s.shareId, resolution).status, 'applied');
  assert.equal(store.submit(s.shareId, s.capability, retry).status, 'applied');
  assert.equal(store.read(s.shareId, s.capability).context, null);
  assert.equal(store.ownerRead(s.shareId).proposal, null);
  assert.throws(() => store.resolve(s.shareId, { ...resolution, outcome: 'rejected', selectedIds: [] }), e => e.code === 'PROPOSAL_CONFLICT');
});

test('invalid or stale proposals do not occupy the review slot', () => {
  const store = createShareStore(), s = store.create(settings()), value = submission(s);
  for (const input of [
    { ...value, contextVersion: randomUUID() }, { ...value, proposalId: 'bad' }, { ...value, execute: 'rm' },
    { ...value, proposal: { ...suggestion(), command: 'touch PRIVATE' } },
    { ...value, proposal: { ...suggestion(), settings: { ...DEFAULT_SETTINGS, thresholdDb: -200 } } },
    { ...value, proposal: JSON.stringify(suggestion()) },
  ]) assert.throws(() => store.submit(s.shareId, s.capability, input));
  assert.equal(store.ownerRead(s.shareId).status, 'waiting');
  assert.equal(store.submit(s.shareId, s.capability, value).status, 'proposed');
});

test('caption scope rejects different source text, unshared cues and changed numbers', () => {
  const store = createShareStore(), request = { requestId: randomUUID(), instruction: '오타 교정', glossary: '', cues: [{ id: 'c1', text: '영상 2개 입니디.' }] };
  const s = store.create({ task: 'correction', request });
  const proposal = { requestId: request.requestId, changes: [{ id: 'c1', before: request.cues[0].text, after: '영상 2개입니다.', reason: '오타 수정' }] };
  for (const changes of [[{ ...proposal.changes[0], id: 'not-shared' }], [{ ...proposal.changes[0], before: '다른 원문' }], [{ ...proposal.changes[0], after: '영상 3개입니다.' }]]) assert.throws(() => store.submit(s.shareId, s.capability, submission(s, { ...proposal, changes })));
  const value = submission(s, proposal); store.submit(s.shareId, s.capability, value);
  assert.throws(() => store.resolve(s.shareId, { contextVersion: s.contextVersion, proposalId: value.proposalId, outcome: 'applied', selectedIds: ['not-shared'] }));
  assert.equal(store.resolve(s.shareId, { contextVersion: s.contextVersion, proposalId: value.proposalId, outcome: 'applied', selectedIds: ['c1'] }).status, 'applied');
});

test('effect sharing retains aliases only and validates selected assets', () => {
  const store = createShareStore(), { input, proposal } = effectProposalFixture(), s = store.create({ task: 'effects', request: input });
  assert.doesNotMatch(JSON.stringify(store.read(s.shareId, s.capability)), /private-|local-media-id|보내지 않을/);
  const bad = structuredClone(proposal); bad.changes[0].after.assetId = 'asset-8';
  assert.throws(() => store.submit(s.shareId, s.capability, submission(s, bad)));
  const value = submission(s, proposal); store.submit(s.shareId, s.capability, value);
  assert.deepEqual(store.ownerRead(s.shareId).proposal, proposal);
  assert.equal(store.resolve(s.shareId, { contextVersion: s.contextVersion, proposalId: value.proposalId, outcome: 'rejected', selectedIds: [] }).status, 'rejected');
});

test('model polling cannot renew a lease; app polling cannot extend absolute expiry', () => {
  let time = 100; const store = createShareStore({ now: () => time }), a = store.create(settings());
  time += SHARE_LIMITS.leaseMs - 1;
  assert.equal(store.read(a.shareId, a.capability).status, 'waiting'); time++;
  unavailable(() => store.read(a.shareId, a.capability));
  const b = store.create(settings());
  while (time + 30_000 < b.expiresAt) { time += 30_000; store.ownerRead(b.shareId); }
  time = b.expiresAt; unavailable(() => store.ownerRead(b.shareId));
});

test('revoke, application close, payload size and share count are bounded', () => {
  let time = 0; const store = createShareStore({ now: () => time }), all = [];
  assert.throws(() => store.create({ ...settings(), secret: 'not-shared' }));
  assert.throws(() => store.create({ task: 'shell', request: {} }));
  assert.throws(() => store.create({ task: 'settings', request: { instruction: '한'.repeat(SHARE_LIMITS.bytes), settings: DEFAULT_SETTINGS } }), e => e.status === 413);
  for (let i = 0; i < SHARE_LIMITS.shares; i++) all.push(store.create(settings()));
  assert.throws(() => store.create(settings()), e => e.code === 'SHARE_LIMIT');
  store.revoke(all[0].shareId); unavailable(() => store.read(all[0].shareId, all[0].capability));
  store.create(settings()); time = SHARE_LIMITS.leaseMs; store.sweep(); store.create(settings());
  store.close(); assert.throws(() => store.create(settings()), e => e.code === 'SHARE_UNAVAILABLE');
  unavailable(() => store.ownerRead(all[1].shareId));
});
