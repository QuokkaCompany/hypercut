import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings, normalizeIntervals, createCuts, keptIntervals, sourceToEdited, editedToSource, snapRemovals, makeProject, validateProject, videoExpressions } from '../shared/timeline.mjs';
const frames = Array.from({ length: 601 }, (_, i) => i / 30);
const justRanges = cuts => cuts.map(({ start, end }) => [start, end]);

test('D04: padding uses the trailing margin at silence start and leading margin at its end', () => {
  const result = createCuts([{ start: 10, end: 12 }], DEFAULT_SETTINGS, 20, Array.from({ length: 2001 }, (_, i) => i / 100));
  assert.deepEqual(justRanges(result), [[10.15, 11.9]]);
});
test('D05: leading and trailing silence have only the adjacent speech margin', () => {
  const result = createCuts([{ start: 0, end: 2 }, { start: 18, end: 20 }], DEFAULT_SETTINGS, 20, Array.from({ length: 2001 }, (_, i) => i / 100));
  assert.deepEqual(justRanges(result), [[0, 1.9], [18.15, 20]]);
});
test('D06: negative, short and exact 100 ms cuts', () => {
  const s = { ...DEFAULT_SETTINGS, minSilenceMs: 50, preRollMs: 0, postRollMs: 0 };
  assert.equal(createCuts([{ start: 1, end: 1.09 }], s, 20, frames).length, 0);
  assert.deepEqual(justRanges(createCuts([{ start: 1, end: 1.1 }], s, 20, frames)), [[1, 1.1]]);
  assert.equal(createCuts([{ start: 1.01, end: 1.11 }], s, 20, frames).length, 0);
  assert.equal(createCuts([{ start: 1, end: 1.5 }], { ...s, preRollMs: 500, postRollMs: 500 }, 20, frames).length, 0);
});
test('D07: canonical intervals clip, sort, merge, reject corrupt values', () => {
  assert.deepEqual(normalizeIntervals([{ start: 4, end: 8 }, { start: -1, end: 2 }, { start: 1, end: 5 }, { start: 9, end: 12 }], 10), [{ start: 0, end: 8 }, { start: 9, end: 10 }]);
  for (const interval of [{ start: NaN, end: 2 }, { start: 3, end: 2 }, { start: 1, end: Infinity }]) assert.throws(() => normalizeIntervals([interval], 10));
});
test('D10: inward snapping uses actual VFR timestamps', () => {
  assert.deepEqual(snapRemovals([{ start: 0.08, end: 0.49 }], 1, [0, 0.04, 0.11, 0.23, 0.46, 0.6, 1]), [{ start: 0.11, end: 0.46 }]);
});
test('D11: timeline mapping covers disjoint retained source ranges', () => {
  const kept = keptIntervals([{ start: 1, end: 3, enabled: true }, { start: 5, end: 7, enabled: false }, { start: 8, end: 10, enabled: true }], 10);
  assert.deepEqual(kept, [{ start: 0, end: 1 }, { start: 3, end: 8 }]);
  assert.equal(sourceToEdited(4, kept), 2);
  assert.equal(editedToSource(1, kept), 3);
  assert.equal(editedToSource(6, kept), 8);
});
test('D12: full silence gives an empty edit, and zero cuts keeps all video', () => {
  assert.deepEqual(keptIntervals(createCuts([{ start: 0, end: 20 }], DEFAULT_SETTINGS, 20, frames), 20), []);
  assert.deepEqual(keptIntervals([], 20), [{ start: 0, end: 20 }]);
});
test('D14: saved project preserves disabled cuts and refuses corrupt identifiers', () => {
  const project = makeProject({ name: '테스트.mp4', fingerprint: 'a'.repeat(64), duration: 20 }, DEFAULT_SETTINGS, 1, [{ id: 'a', start: 1, end: 2, enabled: false }]);
  assert.equal(validateProject(JSON.parse(JSON.stringify(project))).cuts[0].enabled, false);
  assert.throws(() => validateProject({ ...project, version: 5 }));
  assert.throws(() => validateProject({ ...project, cuts: [...project.cuts, ...project.cuts] }));
  assert.throws(() => validateProject({ ...project, cuts: [{ id: 'a', start: 1, end: 21, enabled: true }] }));
  assert.throws(() => validateProject({ ...project, cuts: [{ id: 'a', start: '1', end: 2, enabled: true }] }));
});
test('settings reject missing, out of range and string values', () => {
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, thresholdDb: 1 }));
  assert.throws(() => validateSettings({ ...DEFAULT_SETTINGS, minSilenceMs: '500' }));
  assert.deepEqual(validateSettings(DEFAULT_SETTINGS), DEFAULT_SETTINGS);
});
test('large video expressions have bounded nesting depth', () => {
  const { select } = videoExpressions(Array.from({ length: 1000 }, (_, i) => ({ start: i * 2, end: i * 2 + 0.5 })));
  let depth = 0, max = 0;
  for (const character of select) { if (character === '(') { depth++; max = Math.max(max, depth); } if (character === ')') depth--; }
  assert.ok(max < 30); assert.equal(depth, 0);
});
