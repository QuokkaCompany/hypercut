import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, validateSettings, normalizeIntervals, createCuts, keptIntervals, sourceToEdited, editedToSource, snapRemovals, makeProject, validateProject, videoExpressions, restoreRange, renderPlan } from '../shared/timeline.mjs';
const frames = Array.from({ length: 601 }, (_, i) => i / 30);
const justRanges = cuts => cuts.map(({ start, end }) => [start, end]);

test('M06: preview windows keep export cuts, restored decisions and source-to-preview mapping', () => {
  const cuts = [{ start: 4, end: 6, enabled: true }, { start: 6, end: 7, enabled: false }];
  const previous = structuredClone(cuts);
  const plan = renderPlan(cuts, 20, frames, { start: 2, end: 8 });
  assert.deepEqual(justRanges(plan.kept), [[2, 4], [6, 8]]);
  assert.deepEqual(plan.sourceRange, { start: 2, end: 8 });
  assert.equal(sourceToEdited(5, plan.kept), 2); assert.equal(editedToSource(2, plan.kept), 6);
  assert.deepEqual(cuts, previous);
  assert.deepEqual(justRanges(renderPlan(cuts, 20, frames).kept), [[0, 4], [6, 20]]);
});

test('M06: preview edges expand to frames without leaking short excluded tails', () => {
  const plan = renderPlan([], 20, frames, { start: 0.04, end: 19.94 });
  assert.deepEqual(justRanges(plan.kept), [[1 / 30, 599 / 30]]);
  assert.deepEqual(justRanges(plan.removals), [[0, 1 / 30], [599 / 30, 20]]);
  for (const range of [null, {}, { start: -1, end: 3 }, { start: 3, end: 3 }, { start: 0, end: 21 }]) assert.throws(() => renderPlan([], 20, frames, range), /범위/);
});

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
  assert.throws(() => validateProject({ ...project, version: 10 }));
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
test('U03: restoring part of a fully removed clip expands to whole frames',()=>{
  const result=restoreRange([{id:'all',start:0,end:4,enabled:true,reason:'silence'}],1.01,1.99,4,frames);
  assert.deepEqual(result.map(({start,end,enabled})=>({start,end,enabled})),[{start:0,end:1,enabled:true},{start:1,end:2,enabled:false},{start:2,end:4,enabled:true}]);
  assert.equal(new Set(result.map(x=>x.id)).size,3);
  assert.deepEqual(keptIntervals(result,4),[{start:1,end:2}]);
});
test('U03: partial restoration also preserves sub-100ms leftovers and existing restored edits',()=>{
  const input=[{id:'old',start:0,end:4,enabled:true},{id:'restore-0',start:5,end:6,enabled:false}];
  const result=restoreRange(input,0.08,3.98,6,frames);
  assert.deepEqual(result.map(x=>[x.start,x.end,x.enabled]),[[0,4,false],[5,6,false]]);
  assert.equal(new Set(result.map(x=>x.id)).size,2);
  assert.equal(input[0].enabled,true);
});
test('U03: restoration refuses invalid ranges and preserves unrelated cuts',()=>{
  const input=[{id:'a',start:0,end:1,enabled:true}];
  assert.deepEqual(restoreRange(input,2,3,4,frames),input);
  for(const [start,end]of[[2,1],[-1,2],[0,5],[NaN,1]])assert.throws(()=>restoreRange(input,start,end,4,frames));
});
