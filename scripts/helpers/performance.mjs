import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
export function processTreeRSS(output, roots) {
  const rows = output.trim().split('\n').filter(Boolean).map(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) throw new Error('Invalid process RSS sample');
    return { pid: Number(match[1]), parent: Number(match[2]), bytes: Number(match[3]) * 1024, name: match[4].split('/').at(-1) };
  });
  if (!roots.length || roots.some(root => !rows.some(row => row.pid === root))) throw new Error('A measured app root process is missing');
  const ids = new Set(roots); let changed = true;
  while (changed) { changed = false; for (const row of rows) if (ids.has(row.parent) && !ids.has(row.pid)) { ids.add(row.pid); changed = true; } }
  const included = rows.filter(row => ids.has(row.pid));
  return { bytes: included.reduce((sum, row) => sum + row.bytes, 0), processes: included };
}
export function summarize(values) {
  if (!values.length || values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Invalid measurement values');
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return { count: values.length, median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2, max: sorted.at(-1), p95: sorted.length >= 30 ? sorted[Math.ceil(sorted.length * .95) - 1] : null };
}
export function rssSampler(roots) {
  let inFlight, timer;
  const samples = [], errors = [], start = performance.now();
  async function sample() {
    if (inFlight) return inFlight;
    inFlight = (async () => { try { const result = processTreeRSS((await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=,comm='], { maxBuffer: 4 * 1024 ** 2 })).stdout, roots); samples.push({ milliseconds: performance.now() - start, ...result }); } catch (error) { errors.push(error.message); } })();
    try { await inFlight; } finally { inFlight = undefined; }
  }
  return { async start() { await sample(); timer = setInterval(() => { void sample(); }, 250); }, async stop() { clearInterval(timer); await inFlight; await sample(); return { sampleIntervalMs: 250, peakBytes: samples.length ? Math.max(...samples.map(sample => sample.bytes)) : null, samples, errors }; } };
}
