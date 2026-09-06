import test from 'node:test';
import assert from 'node:assert/strict';
import { validateEffects, mapEffects } from '../shared/effects.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
const id = 'a'.repeat(64), asset = { id, fingerprint: id, name: 'beep.wav', duration: 3 };
const clip = (key, start, extra = {}) => ({ id: key, assetId: id, start, offset: 0, duration: 2, gainDb: -12, muted: false, ...extra });
const kept = [{ start: 0, end: 2 }, { start: 4, end: 8 }, { start: 9, end: 12 }];
test('source anchors map independently, deleted starts stay absent and restoration reappears', () => {
  const fx = validateEffects({ assets: [asset], clips: [clip('a', 5), clip('b', 2.5), clip('c', 1.5), clip('d', 11.5)] }, 12);
  assert.deepEqual(mapEffects(fx, kept).map(({ id, start, duration }) => ({ id, start, duration })), [{ id: 'a', start: 3, duration: 2 }, { id: 'c', start: 1.5, duration: 2 }, { id: 'd', start: 8.5, duration: .5 }]);
  assert.equal(mapEffects(fx, [{ start: 0, end: 12 }]).find(c => c.id === 'b').start, 2.5);
  assert.equal(fx.clips[0].start, 5);
});
test('range preview retains ongoing tails with a trimmed asset offset, and honors half-open start boundaries', () => {
  const fx = validateEffects({ assets: [asset], clips: [clip('a', 1.5), clip('b', 2), clip('c', 4), clip('d', 7.5, { offset: 2.5 }), clip('mute', 5, { muted: true })] }, 12);
  const result = mapEffects(fx, kept, { start: 2.5, end: 6 });
  assert.deepEqual(result.map(({ id, start, offset, duration }) => ({ id, start, offset, duration })), [{ id: 'a', start: 0, offset: 1, duration: 1 }, { id: 'c', start: 0, offset: .5, duration: 1.5 }, { id: 'd', start: 3, offset: 2.5, duration: .5 }]);
});
test('reject corrupt identities, duplicates, nonfinite/range values and missing assets; strip runtime paths', () => {
  const valid = { assets: [asset], clips: [clip('a', 1)] };
  assert.deepEqual(validateEffects({ assets: [{ ...asset, path: '/private' }], clips: [clip('a', 1, { path: '/private' })] }, 12), valid);
  for (const c of [{ start: 12 }, { start: NaN }, { offset: 3 }, { duration: 0 }, { gainDb: 13 }, { muted: 1 }, { assetId: 'b'.repeat(64) }]) assert.throws(() => validateEffects({ ...valid, clips: [clip('a', 1, c)] }, 12));
  assert.throws(() => validateEffects({ ...valid, clips: [clip('a', 1), clip('a', 2)] }, 12));
  assert.throws(() => validateEffects({ ...valid, assets: [{ ...asset, fingerprint: 'bad' }] }, 12));
  assert.throws(() => validateEffects({ ...valid, assets: [asset, asset] }, 12));
});
test('v5 saves effects and legacy v1-v4 migrate to empty effects without changing captions/cuts', () => {
  const fx = { assets: [asset], clips: [clip('a', 1)] }, media = { name: 'fixture.mp4', fingerprint: 'b'.repeat(64), duration: 12 };
  const project = makeProject(media, DEFAULT_SETTINGS, 1, [], undefined, null, undefined, fx);
  assert.equal(project.version, 6); assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))).effects, fx);
  assert.throws(() => validateProject({ ...project, effects: undefined }));
  for (const version of [1, 2, 3, 4]) { const migrated = validateProject({ ...project, version, effects: undefined }); assert.deepEqual(migrated.effects, { assets: [], clips: [] }); assert.deepEqual(migrated.cuts, []); }
});
