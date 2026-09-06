import test from 'node:test';
import assert from 'node:assert/strict';
import { processTreeRSS, summarize } from '../scripts/helpers/performance.mjs';
test('benchmark RSS counts two app trees once, excludes the driver and rejects lost roots', () => {
  const rows = '1 0 500 /system\n100 1 1000 driver\n200 100 200 app-server\n201 200 300 ffmpeg\n300 100 400 chrome\n301 300 500 chrome-helper\n302 301 600 renderer';
  const sample = processTreeRSS(rows, [200, 300, 301]);
  assert.equal(sample.bytes, 2000 * 1024); assert.deepEqual(sample.processes.map(row => row.pid), [200, 201, 300, 301, 302]);
  assert.throws(() => processTreeRSS(rows, [999]), /missing/); assert.throws(() => processTreeRSS('unreadable', [200]), /Invalid/);
});
test('benchmark summaries do not claim p95 from three runs and preserve raw values', () => {
  const values = [3, 1, 2]; assert.deepEqual(summarize(values), { count: 3, median: 2, max: 3, p95: null }); assert.deepEqual(values, [3, 1, 2]);
  assert.deepEqual(summarize([4, 2, 1, 3]), { count: 4, median: 2.5, max: 4, p95: null });
  assert.equal(summarize(Array.from({ length: 30 }, (_, i) => i + 1)).p95, 29); assert.throws(() => summarize([])); assert.throws(() => summarize([NaN]));
});
