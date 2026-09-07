import { randomUUID } from 'node:crypto';
import { validateMediaJob, isRequestId } from '../engine.mjs';
import { validateProject, makeProject } from '../../shared/timeline.mjs';
import { requireValue } from './store.mjs';

export const activeStatuses = ['queued', 'running'];
const canonical = value => JSON.stringify(value, function (_key, item) { return item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item; });
export const publicJob = job => {
  const { id, type, status, progress, stage, error, result, projectId, baseVersion, mediaId, createdAt, finishedAt, appliedVersion } = job;
  return { id, type, status, progress, stage, error, result, projectId, baseVersion, mediaId, createdAt, finishedAt, appliedVersion };
};
export function validateOwnedProject(store, owner, mediaId, value) {
  const media = store.need('media', mediaId, owner), project = validateProject(value);
  requireValue(project.media.fingerprint === media.fingerprint && Math.abs(project.media.duration - media.duration) < 0.001, 400, 'Project does not match the uploaded source.');
  requireValue(media.audioTracks.some(x => x.index === project.trackIndex), 400, 'Audio track is unavailable.');
  if (project.transcript) requireValue(media.audioTracks.some(x => x.index === project.transcript.trackIndex && x.channels > project.transcript.channel), 400, 'Transcript track is unavailable.');
  for (const effect of project.effects.assets) {
    const asset = store.need('effect', effect.id, owner);
    requireValue(asset.fingerprint === effect.fingerprint && asset.duration === effect.duration, 400, 'Effect does not match the uploaded source.');
  }
  // Rebuild the portable schema instead of persisting arbitrary client metadata.
  return makeProject(media, project.settings, project.trackIndex, project.cuts, project.speechProtection, project.transcript, project.captionStyle, project.effects, project.glossary);
}
export function installJobs(app, route, { store, quota }) {
  app.get('/api/jobs', (req, res) => res.json(store.list('job', req.session.owner).map(publicJob)));
  app.get('/api/jobs/:id', (req, res) => res.json(publicJob(store.need('job', req.params.id, req.session.owner))));
  app.post('/api/jobs', route(async (req, res) => {
    const owner = req.session.owner, input = req.body, id = input.requestId || randomUUID();
    requireValue(isRequestId(id), 400, 'Invalid job ID.');
    const job = store.transaction(() => {
      const previous = store.get('job', id, owner);
      if (previous) { requireValue(canonical(previous.input) === canonical(input), 409, 'Job ID was already used for different input.'); return previous; }
      requireValue(!store.db.prepare("SELECT 1 FROM records WHERE kind='job' AND id=?").get(id), 409, 'Job ID is unavailable.');
      const media = store.need('media', input.mediaId, owner);
      validateMediaJob(input, media);
      for (const asset of input.effects?.assets || []) store.need('effect', asset.id, owner);
      let baseVersion;
      if (input.projectId) { const project = store.need('project', input.projectId, owner); requireValue(project.mediaId === media.id && project.version === input.baseVersion, 409, 'Project changed. Save and retry.'); baseVersion = project.version; }
      requireValue(store.list('job', owner).filter(x => activeStatuses.includes(x.status)).length < 4, 429, 'Finish or cancel existing jobs first.');
      requireValue(store.list('job', owner).length < 500, 429, 'Remove old jobs before adding more.');
      const reservation = ['export', 'preview', 'captions', 'transcript'].includes(input.type) ? Math.max(32 * 1024 ** 2, media.size * 3) : 0;
      requireValue(store.usage(owner) + reservation <= quota, 413, 'Insufficient storage quota for this output.');
      const cancelled = store.get('cancel', id, owner);
      return store.put('job', { id, owner, input, type: input.type, mediaId: media.id, projectId: input.projectId, baseVersion, status: cancelled ? 'cancelled' : 'queued', progress: 0, stage: cancelled ? 'Cancelled' : 'Queued', reservation: cancelled ? 0 : reservation }, cancelled ? 0 : reservation);
    });
    res.status(202).json(publicJob(job));
  }));
  app.delete('/api/jobs/:id', (req, res) => {
    const owner = req.session.owner, id = req.params.id;
    requireValue(isRequestId(id), 400, 'Invalid job ID.');
    store.transaction(() => {
      const job = store.get('job', id, owner);
      if (!job) {
        requireValue(!store.db.prepare("SELECT 1 FROM records WHERE kind='job' AND id=?").get(id), 404, 'Job not found.');
        const old = store.list('cancel', owner); for (const item of old.slice(255)) store.remove('cancel', item.id, owner);
        store.put('cancel', { id, owner }); return;
      }
      if (job.status === 'queued') store.put('job', { ...job, status: 'cancelled', stage: 'Cancelled', finishedAt: Date.now(), reservation: 0 });
      else if (job.status === 'running') store.put('job', { ...job, cancelRequested: true, stage: 'Cancelling' }, job.reservation);
    });
    res.json({ cancelled: true });
  });
  app.delete('/api/jobs/:id/record', (req, res) => {
    const job = store.need('job', req.params.id, req.session.owner);
    requireValue(!activeStatuses.includes(job.status), 409, 'Cancel this job first.'); store.remove('job', job.id, job.owner); res.json({ deleted: true });
  });
  app.post('/api/jobs/:id/apply', (req, res) => {
    const project = store.transaction(() => {
      const job = store.need('job', req.params.id, req.session.owner);
      requireValue(job.status === 'completed' && ['analyze', 'restore', 'transcribe'].includes(job.type) && job.projectId, 409, 'This job has no editable result.');
      const project = store.need('project', job.projectId, job.owner);
      if (job.appliedVersion) return project;
      requireValue(project.version === job.baseVersion, 409, 'Project changed since this job started. Open it to review; current edits were preserved.');
      const data = { ...project.data, ...(job.type === 'transcribe' ? { transcript: job.result } : { cuts: job.result.cuts }) };
      const updated = store.put('project', { ...project, data: validateOwnedProject(store, job.owner, project.mediaId, data), version: project.version + 1 });
      store.put('job', { ...job, appliedVersion: updated.version });
      return updated;
    });
    res.json({ id: project.id, name: project.name, mediaId: project.mediaId, data: project.data, version: project.version });
  });
}
