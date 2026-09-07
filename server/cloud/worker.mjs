import { randomUUID } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { executeMediaJob } from '../engine.mjs';
import { openStore } from './store.mjs';
import { fileURLToPath } from 'node:url';

export async function startWorker({ dataDir, pollMs = 500, leaseMs = 15000, timeoutMs = 2 * 3600_000, quota = 10 * 1024 ** 3 } = {}) {
  const store = openStore(dataDir), workerId = randomUUID();
  let stopping = false, controller, active, timer;
  const interrupted = 'Worker interrupted. Review the project and submit a new job to retry.';
  async function tick() {
    if (stopping || active) return;
    const expired = store.transaction(() => {
      const jobs = store.all('job').filter(x => x.status === 'running' && x.leaseUntil < Date.now());
      for (const job of jobs) store.put('job', { ...job, status: 'failed', error: interrupted, stage: 'Interrupted', reservation: 0, finishedAt: Date.now() });
      return jobs;
    });
    // Each attempt owns an isolated directory, so stale workers cannot publish another attempt's output.
    for (const job of expired) if (job.attempt) await rm(path.join(dataDir, 'jobs', job.attempt), { recursive: true, force: true });
    const job = store.transaction(() => {
      const jobs = store.all('job'), owners = new Set(jobs.filter(x => x.status === 'running').map(x => x.owner));
      const queued = jobs.find(x => x.status === 'queued' && !owners.has(x.owner));
      return queued && store.put('job', { ...queued, status: 'running', workerId, attempt: randomUUID(), leaseUntil: Date.now() + leaseMs, stage: 'Starting' }, queued.reservation);
    });
    if (!job) return;
    controller = new AbortController();
    active = execute(job, controller).finally(() => { active = null; controller = null; });
    await active;
  }
  async function execute(job, abort) {
    const directory = path.join(dataDir, 'jobs', job.attempt);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let progress = {}, output, success = false;
    const heartbeat = setInterval(() => {
      try {
        store.transaction(() => {
          const current = store.get('job', job.id, job.owner);
          if (!current || current.status !== 'running' || current.attempt !== job.attempt || current.cancelRequested || stopping) { abort.abort(); return; }
          store.put('job', { ...current, ...progress, leaseUntil: Date.now() + leaseMs }, current.reservation);
        });
      } catch { abort.abort(); }
    }, Math.min(500, leaseMs / 3));
    try {
      const media = store.need('media', job.mediaId, job.owner);
      const effectAssets = new Map(store.list('effect', job.owner).map(item => [item.id, item]));
      output = await executeMediaJob(job.input, media, directory, { effectAssets, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeoutMs)]), progress: value => { progress = value; } });
      const bytes = output.path ? (await stat(output.path)).size : 0;
      success = store.transaction(() => {
        const current = store.need('job', job.id, job.owner);
        if (current.attempt !== job.attempt || current.status !== 'running' || current.cancelRequested || abort.signal.aborted) return false;
        if (store.usage(job.owner) - current.reservation + bytes > quota) throw new Error('Output exceeds the account storage quota.');
        let result = output;
        if (output.path) { store.put('export', { ...output, owner: job.owner, jobId: job.id, mediaId: job.mediaId }, bytes); const { path: omitted, ...safe } = output; result = safe; }
        store.put('job', { ...current, status: 'completed', stage: 'Completed', progress: 1, result, reservation: 0, finishedAt: Date.now() });
        return true;
      });
    } catch (error) {
      // Engine validation messages are useful, but filesystem paths must not cross the tenant boundary.
      job.failure = String(error.message).replaceAll(dataDir, '[storage]').slice(0, 500);
    } finally {
      clearInterval(heartbeat);
      if (!success) {
        store.transaction(() => {
          const current = store.get('job', job.id, job.owner);
          if (current?.status === 'running' && current.attempt === job.attempt) store.put('job', { ...current, status: current.cancelRequested ? 'cancelled' : 'failed', stage: current.cancelRequested ? 'Cancelled' : 'Failed', error: stopping ? interrupted : job.failure, reservation: 0, finishedAt: Date.now() });
        });
        await rm(directory, { recursive: true, force: true });
      } else if (!output.path) await rm(directory, { recursive: true, force: true });
    }
  }
  let polling = false;
  timer = setInterval(() => { if (polling) return; polling = true; tick().catch(error => console.error('Worker cycle failed:', error.message)).finally(() => { polling = false; }); }, pollMs);
  return { store, async close() { stopping = true; clearInterval(timer); controller?.abort(); await active; while (polling) await new Promise(resolve => setTimeout(resolve, 10)); store.close(); } };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const worker = await startWorker({ dataDir: path.resolve(process.env.HYPERCUT_CLOUD_DATA || '.hypercut/cloud'), quota: Number(process.env.HYPERCUT_CLOUD_QUOTA_BYTES || 10 * 1024 ** 3) });
  console.log('HyperCut cloud worker ready.');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => worker.close().then(() => process.exit()));
}
