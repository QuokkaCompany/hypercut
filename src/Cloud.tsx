import { useEffect, useRef, useState } from 'react';
import App from './App';
import { bootstrap, request, outputURL } from './api';
import type { Job, Media } from './types';
import { DEFAULT_SETTINGS, makeProject, type validateProject } from '../shared/timeline.mjs';
import './cloud.css';

export type CloudProject = { id: string; name: string; mediaId: string; data: ReturnType<typeof validateProject>; version: number };
export type CloudEditor = {
  initial?: { project: CloudProject; media: Media };
  save: (data: CloudProject['data'], media: Media) => Promise<{ projectId: string; baseVersion: number }>;
  exit: () => void;
};
type CloudJob = Job & { projectId?: string; baseVersion?: number; appliedVersion?: number };

export default function RuntimeApp() {
  const [mode, setMode] = useState(''), [error, setError] = useState('');
  useEffect(() => { fetch('/api/runtime').then(async response => { if (!response.ok) throw new Error('Unable to reach HyperCut.'); setMode((await response.json()).mode); }).catch(e => setError(e.message)); }, []);
  if (error) return <main className="cloud-page"><p role="alert">{error}</p><button onClick={() => location.reload()}>Retry</button></main>;
  return mode === 'local' ? <App /> : mode === 'cloud' ? <CloudShell /> : <main className="cloud-page">Connecting to HyperCut…</main>;
}
function CloudShell() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null), [checking, setChecking] = useState(true);
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const [projects, setProjects] = useState<CloudProject[]>([]), [jobs, setJobs] = useState<CloudJob[]>([]), [assets, setAssets] = useState<Media[]>([]);
  const [outputs, setOutputs] = useState<{ id: string; name: string }[]>([]), [uploads, setUploads] = useState<{ id: string; name: string; offset: number; size: number }[]>([]);
  const [editor, setEditor] = useState<{ key: string; initial?: CloudEditor['initial'] } | null>(null);
  const saved = useRef<CloudProject | null>(null), generation = useRef(0);
  async function refresh() {
    const revision = generation.current;
    const [p, j, m, o, u] = await Promise.all([request<CloudProject[]>('/projects'), request<CloudJob[]>('/jobs'), request<Media[]>('/media'), request<{ id: string; name: string }[]>('/exports'), request<{ id: string; name: string; offset: number; size: number }[]>('/uploads')]);
    if (revision !== generation.current) return;
    setProjects(p); setJobs(j); setAssets(m); setOutputs(o); setUploads(u);
  }
  useEffect(() => { request<{ user: { id: string; email: string } }>('/auth/me').then(async value => { await bootstrap(); setUser(value.user); }).catch(() => {}).finally(() => setChecking(false)); }, []);
  useEffect(() => {
    if (!user || editor) return;
    let live = true, pending = false;
    const load = async () => { if (pending) return; pending = true; try { await refresh(); } catch (e) { if (live) setError((e as Error).message); } finally { pending = false; } };
    void load(); const timer = setInterval(() => void load(), 3000);
    return () => { live = false; clearInterval(timer); };
  }, [user, editor]);
  async function action(fn: () => Promise<void>) { setWorking(true); setError(''); try { await fn(); } catch (e) { setError((e as Error).message); } finally { setWorking(false); } }
  async function openProject(project: CloudProject) {
    const current = await request<CloudProject>(`/projects/${project.id}`), media = await request<Media>(`/media/${current.mediaId}`);
    saved.current = current; setEditor({ key: current.id, initial: { project: current, media } });
  }
  async function save(data: CloudProject['data'], media: Media) {
    const current = saved.current?.mediaId === media.id ? saved.current : null;
    const result = await request<CloudProject>(current ? `/projects/${current.id}` : '/projects', { name: current?.name || media.name, mediaId: media.id, data, version: current?.version }, current ? 'PUT' : 'POST');
    saved.current = result; return { projectId: result.id, baseVersion: result.version };
  }
  if (checking) return <main className="cloud-page">Checking session…</main>;
  if (!user) return <main className="cloud-login"><form onSubmit={event => { event.preventDefault(); void action(async () => { const value = await request<{ user: { id: string; email: string } }>('/auth/login', { email, password }); await bootstrap(); setPassword(''); setUser(value.user); }); }}>
    <span className="cloud-eyebrow">HYPERCUT / CLOUD BETA</span><h1>Your edit, anywhere.</h1><p>Sign in to your HyperCut host. Video processing runs on this server.</p>
    <label>Email<input type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} required /></label>
    <label>Password<input type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required /></label>
    {error && <p role="alert" className="cloud-error">{error}</p>}<button className="button primary" disabled={working}>Sign in</button>
    <small>Accounts are created by this host’s operator. Prefer offline editing? Use the open-source local edition.</small>
  </form></main>;
  if (editor) return <App key={editor.key} cloud={{ initial: editor.initial, save, exit: () => setEditor(null) }} />;
  return <main className="cloud-page">
    <header className="cloud-header"><div><span className="cloud-eyebrow">HYPERCUT / CLOUD BETA</span><h1>Your workspace</h1><p>{user.email} · Files are stored on this host.</p></div><div className="cloud-actions"><button className="button primary" onClick={() => { saved.current = null; setEditor({ key: crypto.randomUUID() }); }}>New edit</button><button className="button secondary" disabled={working} onClick={() => void action(async () => { await request('/auth/logout', {}); generation.current++; setUser(null); setProjects([]); setJobs([]); setAssets([]); setOutputs([]); setUploads([]); })}>Sign out</button></div></header>
    {error && <p className="cloud-error" role="alert">{error}</p>}
    <section><h2>Projects</h2><p>Save explicitly in the editor. A snapshot is also saved before each processing job.</p><div className="cloud-grid">{projects.map(project => <article key={project.id}><span className="cloud-eyebrow">REVISION {project.version}</span><h3>{project.name}</h3><p>{project.data.cuts.filter((cut: { enabled: boolean }) => cut.enabled).length} active cuts · {project.data.transcript?.cues.length || 0} captions</p><div className="cloud-actions"><button className="button secondary" disabled={working} onClick={() => void action(() => openProject(project))}>Open</button><button className="button ghost" disabled={working} onClick={() => { if (confirm(`Delete project “${project.name}”? Source media is kept.`)) void action(async () => { await request(`/projects/${project.id}`, undefined, 'DELETE'); await refresh(); }); }}>Delete</button></div></article>)}</div>{!projects.length && <div className="cloud-empty">Start a new edit and upload a video. Your first processing job creates a saved project.</div>}</section>
    <section><h2>Processing jobs</h2><p>Jobs continue when you leave. Apply completed analysis or transcription results before reopening a project.</p><div className="cloud-list">{jobs.map(job => <article key={job.id}><div><strong>{job.type}</strong><p>{job.stage} · {Math.round(job.progress * 100)}%{job.error && ` · ${job.error}`}</p></div><div className="cloud-actions">{['queued', 'running'].includes(job.status) ? <button className="button secondary" disabled={working} onClick={() => void action(async () => { await request(`/jobs/${job.id}`, undefined, 'DELETE'); await refresh(); })}>Cancel</button> : <>{job.status === 'completed' && job.projectId && ['analyze', 'restore', 'transcribe'].includes(job.type) && !job.appliedVersion && projects.some(p => p.id === job.projectId && p.version === job.baseVersion) && <button className="button secondary" disabled={working} onClick={() => void action(async () => { const project = await request<CloudProject>(`/jobs/${job.id}/apply`, {}); await openProject(project); })}>Apply &amp; open</button>}<button className="button ghost" disabled={working} onClick={() => void action(async () => { await request(`/jobs/${job.id}/record`, undefined, 'DELETE'); await refresh(); })}>Dismiss</button></>}</div></article>)}</div>{!jobs.length && <p>No jobs yet.</p>}</section>
    <section><h2>Exports</h2><div className="cloud-list">{outputs.map(output => <article key={output.id}><strong>{output.name}</strong><div className="cloud-actions"><a className="button secondary" href={outputURL(output.id, true)}>Download</a><button className="button ghost" disabled={working} onClick={() => { if (confirm(`Delete export “${output.name}”?`)) void action(async () => { await request(`/exports/${output.id}`, undefined, 'DELETE'); await refresh(); }); }}>Delete</button></div></article>)}</div>{!outputs.length && <p>Completed video and text exports appear here.</p>}</section>
    <section><h2>Source media</h2><div className="cloud-list">{assets.map(asset => <article key={asset.id}><div><strong>{asset.name}</strong><p>{(asset.size / 1024 ** 2).toFixed(1)} MiB · {asset.duration.toFixed(1)} seconds</p></div><div className="cloud-actions"><button className="button secondary" disabled={working || !asset.audioTracks.length} onClick={() => void action(async () => { const project = await request<CloudProject>('/projects', { name: asset.name, mediaId: asset.id, data: makeProject(asset, DEFAULT_SETTINGS, asset.audioTracks[0].index, [], undefined, null, undefined, undefined) }); await openProject(project); })}>New project</button><button className="button ghost" disabled={working} onClick={() => { if (confirm(`Delete source “${asset.name}”? Saved projects must be removed first.`)) void action(async () => { await request(`/media/${asset.id}`, undefined, 'DELETE'); await refresh(); }); }}>Delete</button></div></article>)}</div></section>
    {!!uploads.length && <section><h2>Paused uploads</h2><p>To resume, start a new edit and select the same file. Uploaded chunks are verified before continuing.</p><div className="cloud-list">{uploads.map(item => <article key={item.id}><span>{item.name} · {Math.round(item.offset / item.size * 100)}%</span><button className="button ghost" disabled={working} onClick={() => void action(async () => { await request(`/uploads/${item.id}`, undefined, 'DELETE'); await refresh(); })}>Discard</button></article>)}</div></section>}
  </main>;
}
