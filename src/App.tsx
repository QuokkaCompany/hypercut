import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpFromLine, AudioLines, Check, ChevronDown, CircleHelp, Clapperboard, Clock3, Download, FileVideo2, FolderOpen, HardDrive, LoaderCircle, Maximize2, Monitor, Pause, Play, Plus, Redo2, RotateCcw, Save, Scissors, Settings2, ShieldCheck, SkipBack, Sparkles, Undo2, X } from 'lucide-react';
import { DEFAULT_SETTINGS, editedToSource, intervalDuration, keptIntervals, makeProject, sourceToEdited, validateProject } from '../shared/timeline.mjs';
import { bootstrap, fileURL, outputURL, request, upload, waitJob } from './api';
import type { Analysis, Cut, Job, Media, Output, Settings } from './types';
import { formatSize, formatTime } from './format';
import { Timeline } from './Timeline';
import { AIAssistant } from './AIAssistant';

type History = { past: Cut[][]; present: Cut[]; future: Cut[][] };
type Action = { type: 'load' | 'edit'; cuts: Cut[] } | { type: 'undo' | 'redo' };
function historyReducer(state: History, action: Action): History {
  if (action.type === 'load') return { past: [], present: action.cuts, future: [] };
  if (action.type === 'edit') return { past: [...state.past.slice(-99), state.present], present: action.cuts, future: [] };
  if (action.type === 'undo' && state.past.length) return { past: state.past.slice(0, -1), present: state.past.at(-1)!, future: [state.present, ...state.future] };
  if (action.type === 'redo' && state.future.length) return { past: [...state.past, state.present], present: state.future[0], future: state.future.slice(1) };
  return state;
}

export default function App() {
  const [ready, setReady] = useState(false), [engineError, setEngineError] = useState('');
  const [media, setMedia] = useState<Media | null>(null), [settings, setSettings] = useState<Settings>({ ...DEFAULT_SETTINGS });
  const [trackIndex, setTrackIndex] = useState(0), [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [history, dispatch] = useReducer(historyReducer, { past: [], present: [], future: [] });
  const cuts = history.present;
  const [busy, setBusy] = useState<string | null>(null), [job, setJob] = useState<Job | null>(null);
  const [importProgress, setImportProgress] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [time, setTime] = useState(0), [playing, setPlaying] = useState(false), [mode, setMode] = useState<'original' | 'edited' | 'rendered'>('edited');
  const [selected, setSelected] = useState<string | null>(null), [rendered, setRendered] = useState<Output | null>(null), [output, setOutput] = useState<Output | null>(null);
  const [dialog, setDialog] = useState<'help' | 'engine' | null>(null), [dragging, setDragging] = useState(false), [unsaved, setUnsaved] = useState(false);
  const [pendingName, setPendingName] = useState('');
  const [aiOpen, setAIOpen] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const video = useRef<HTMLVideoElement>(null), fileInput = useRef<HTMLInputElement>(null), projectInput = useRef<HTMLInputElement>(null);
  const operation = useRef(0), importController = useRef<AbortController | null>(null), pendingProject = useRef<ReturnType<typeof validateProject> | null>(null);
  const activeJob = useRef<{ id: string; controller: AbortController; cancelled: boolean } | null>(null);
  const kept = useMemo(() => media ? keptIntervals(cuts, media.duration) : [], [cuts, media]);
  const editedDuration = intervalDuration(kept), removedDuration = media ? media.duration - editedDuration : 0;
  const activeCuts = cuts.filter(x => x.enabled).length;
  const stale = !!analysis && (JSON.stringify(settings) !== JSON.stringify(analysis.settings) || trackIndex !== analysis.trackIndex);
  const currentCut = cuts.find(x => x.id === selected);
  const videoSrc = media ? (mode === 'rendered' && rendered ? outputURL(rendered.id) : fileURL(media.id, trackIndex)) : undefined;

  useEffect(() => { let live = true; bootstrap().then(config => { if (live) { setReady(true); setEngineError(config.tools.filter(x => !x.available).map(x => x.error).join('\n')); } }).catch(e => { if (live) setEngineError(e.message); }); return () => { live = false; }; }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => { const beforeUnload = (e: BeforeUnloadEvent) => { if (unsaved || busy) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', beforeUnload); return () => window.removeEventListener('beforeunload', beforeUnload); }, [unsaved, busy]);
  useEffect(() => {
    if (!playing || mode !== 'edited' || !video.current) return;
    let frame = 0;
    const tick = () => {
      const player = video.current;
      if (player && !player.paused && !player.seeking) {
        const next = kept.find(x => x.end > player.currentTime + 0.001);
        if (!next) { player.pause(); }
        else if (player.currentTime < next.start) player.currentTime = next.start;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [playing, mode, kept]);
  useEffect(() => { setRendered(null); setOutput(null); setMode(old => old === 'rendered' ? 'edited' : old); }, [cuts, trackIndex]);

  function seekSource(value: number) {
    if (!video.current || !media) return;
    const source = Math.max(0, Math.min(media.duration, value));
    video.current.currentTime = mode === 'rendered' ? sourceToEdited(source, kept) : source; setTime(source);
  }
  function togglePlay() {
    const player = video.current; if (!player || !media) return;
    if (player.paused) {
      if (mode !== 'original' && !kept.length) { setNotice('재생할 구간이 없습니다. 컷을 복원해 주세요.'); return; }
      if (mode === 'edited') { const next = kept.find(x => x.end > player.currentTime + 0.01); player.currentTime = next ? Math.max(player.currentTime, next.start) : kept[0].start; }
      player.play().catch(() => setError('영상을 재생할 수 없습니다. 지원 형식인지 확인해 주세요.'));
    } else player.pause();
  }
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (dialog || aiOpen || restoreOpen || target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (event.code === 'Space' && target.tagName === 'BUTTON') return;
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyO' && !busy) { event.preventDefault(); void chooseVideo(); }
      if ((event.metaKey || event.ctrlKey) && event.code === 'KeyS' && !busy) { event.preventDefault(); saveProject(); }
      if (event.code === 'Space') { event.preventDefault(); togglePlay(); }
      if (event.code === 'ArrowRight') { event.preventDefault(); seekSource(time + 5); }
      if (event.code === 'ArrowLeft') { event.preventDefault(); seekSource(time - 5); }
      if (event.code === 'KeyR' && !event.metaKey && !event.ctrlKey && !event.altKey && selected && !busy) { event.preventDefault(); toggleCut(selected); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !busy) { event.preventDefault(); dispatch({ type: event.shiftKey ? 'redo' : 'undo' }); setUnsaved(true); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  });

  function installMedia(next: Media) {
    const project = pendingProject.current;
    if (project && project.media.fingerprint !== next.fingerprint) throw new Error('프로젝트의 원본과 다른 영상입니다. 같은 원본 파일을 선택해 주세요.');
    if (project && (Math.abs(project.media.duration - next.duration) > 0.001 || project.cuts.some((cut: Cut) => cut.end > next.duration))) throw new Error('프로젝트의 영상 길이 정보가 원본과 일치하지 않습니다.');
    if (project && !next.audioTracks.some(x => x.index === project.trackIndex)) throw new Error('프로젝트의 오디오 트랙을 찾을 수 없습니다.');
    setAnalysis(previous => media?.fingerprint === next.fingerprint ? previous : null);
    setMedia(next); setTime(0); setRendered(null); setOutput(null); setSelected(null); setTimelineZoom(1); setMode('edited'); setPlaying(false);
    if (project) {
      setSettings(project.settings as Settings); setTrackIndex(project.trackIndex); dispatch({ type: 'load', cuts: project.cuts });
      pendingProject.current = null; setPendingName(''); setNotice('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.');
    } else { setTrackIndex(next.audioTracks[0]?.index ?? 0); dispatch({ type: 'load', cuts: [] }); }
    setUnsaved(false);
  }
  async function importFile(file: File) {
    if (busy) return;
    if (unsaved && !window.confirm('저장하지 않은 편집을 닫고 다른 영상을 열까요? 프로젝트를 저장하면 나중에 이어서 편집할 수 있습니다.')) return;
    const id = ++operation.current; setBusy('import'); setImportProgress(0); setError('');
    const controller = new AbortController(); importController.current = controller;
    try { const next = await upload(file, setImportProgress, controller.signal); if (id === operation.current) installMedia(next); }
    catch (e) { if (id === operation.current && (e as Error).name !== 'AbortError') setError((e as Error).message); }
    finally { if (id === operation.current) { setBusy(null); importController.current = null; } }
  }
  async function chooseVideo() {
    if (busy || !ready) return;
    if (window.hypercut) {
      if (unsaved && !window.confirm('저장하지 않은 편집을 닫고 다른 영상을 열까요?')) return;
      setBusy('import'); setError('');
      try { const next = await window.hypercut.pickVideo(); if (next) installMedia(next); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
    } else fileInput.current?.click();
  }
  async function loadDemo() {
    if (busy || (unsaved && !window.confirm('저장하지 않은 편집을 닫고 샘플을 열까요?'))) return; setBusy('import'); setError(''); setImportProgress(0);
    try { installMedia(await request<Media>('/demo', {})); setNotice('실제 음성이 아닌 합성 신호로 만든 16초 검증 샘플입니다.'); } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  }
  async function run(type: 'analyze' | 'preview' | 'export' | 'restore', range?: { start: number; end: number }) {
    if (!media || busy) return;
    video.current?.pause(); setBusy(type); setError(''); setJob(null);
    const id = ++operation.current;
    const active = { id: crypto.randomUUID(), controller: new AbortController(), cancelled: false }; activeJob.current = active;
    setJob({ id: active.id, type, status: 'running', progress: 0, stage: '작업 준비' });
    try {
      const started = await request<Job>('/jobs', { type, mediaId: media.id, settings, trackIndex, cuts, requestId: active.id, range }, undefined, active.controller.signal);
      const completed = await waitJob(started.id, next => { if (operation.current === id) setJob(active.cancelled ? { ...next, stage: '취소 중' } : next); }, active.controller.signal);
      if (operation.current !== id) return;
      if (active.cancelled) { setNotice('작업을 취소했습니다. 기존 편집은 유지됩니다.'); return; }
      if (completed.status === 'failed') throw new Error(completed.error);
      if (completed.status === 'cancelled') { setNotice('작업을 취소했습니다. 기존 편집은 유지됩니다.'); return; }
      if (type === 'analyze') {
        const result = completed.result as Analysis; setAnalysis(result); dispatch({ type: 'edit', cuts: result.cuts }); setUnsaved(true); setSelected(result.cuts[0]?.id ?? null);
        setNotice(result.cuts.length ? `${result.cuts.length}개의 무음 구간을 찾았습니다.` : '현재 설정에 해당하는 무음 구간이 없습니다.');
      } else if (type === 'restore') { edit((completed.result as { cuts: Cut[] }).cuts); setSelected(null); setNotice('선택 범위를 복원했습니다. 실행 취소로 되돌릴 수 있습니다.'); }
      else if (type === 'preview') { setRendered(completed.result as Output); setMode('rendered'); setTime(kept[0]?.start ?? 0); }
      else { setOutput(completed.result as Output); setNotice('내보내기와 결과 파일 검증이 완료됐습니다. 파일을 저장해 주세요.'); }
    } catch (e) { if (operation.current !== id) return; if (active.cancelled) setNotice('작업을 취소했습니다. 기존 편집은 유지됩니다.'); else setError((e as Error).message); }
    finally { if (activeJob.current === active) activeJob.current = null; if (operation.current === id) { setBusy(null); setJob(null); } }
  }
  async function cancel() {
    if (busy === 'import') { importController.current?.abort(); return; }
    const active = activeJob.current; if (!active || active.cancelled) return;
    active.cancelled = true; setJob(previous => previous ? { ...previous, stage: '취소 중' } : previous);
    try { await request(`/jobs/${active.id}`, undefined, 'DELETE'); active.controller.abort(); }
    catch (e) { active.cancelled = false; setError((e as Error).message); }
  }
  function changeSettings(next: Settings | ((previous: Settings) => Settings)) { setSettings(next); if (media) setUnsaved(true); }
  function edit(next: Cut[]) { dispatch({ type: 'edit', cuts: next }); setUnsaved(true); }
  function toggleCut(id: string) { edit(cuts.map(x => x.id === id ? { ...x, enabled: !x.enabled } : x)); }
  async function saveProject() {
    if (!media) return;
    const data = makeProject(media, settings, trackIndex, cuts);
    if (window.hypercut) {
      try { if (await window.hypercut.saveProject(data)) { setUnsaved(false); setNotice('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.'); } }
      catch (e) { setError((e as Error).message); }
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = media.name.replace(/\.[^.]+$/, '') + '.hypercut.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setUnsaved(false); setNotice('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
  }
  async function openProject(file: File) {
    if (busy || (unsaved && !window.confirm('저장하지 않은 편집을 닫고 저장한 프로젝트를 열까요?'))) return;
    try {
      if (file.size > 10 * 1024 ** 2) throw new Error('프로젝트 파일이 너무 큽니다.');
      const project = validateProject(JSON.parse(await file.text())); pendingProject.current = project;
      if (media && media.fingerprint === project.media.fingerprint) installMedia(media);
      else { setPendingName(project.media.name); setNotice(`프로젝트를 읽었습니다. 원본 '${project.media.name}'을 선택해 주세요.`); }
    } catch (e) { setError((e as Error).message); }
  }
  async function downloadOutput() {
    if (!output) return;
    if (window.hypercut) { try { if (await window.hypercut.saveExport(output.id)) setNotice('편집한 영상을 저장했습니다.'); } catch (e) { setError((e as Error).message); } }
    else { const anchor = document.createElement('a'); anchor.href = outputURL(output.id, true); anchor.download = output.name; anchor.click(); }
  }
  const displayedTime = mode === 'original' ? time : sourceToEdited(time, kept);
  const percent = media && removedDuration ? Math.round(removedDuration / media.duration * 100) : 0;

  return <div className="app-shell">
    <input ref={fileInput} type="file" accept=".mp4,.mov,video/mp4,video/quicktime" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void importFile(file); e.target.value = ''; }} />
    <input ref={projectInput} type="file" accept=".json" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void openProject(file); e.target.value = ''; }} />
    <header className="app-header">
      <a className="brand" href="#" onClick={e => e.preventDefault()} aria-label="HyperCut"><span className="brand-mark">H</span><strong>hypercut<span>.</span></strong><span className="beta">PREVIEW</span></a>
      <div className="project-title"><span className="divider" /><span>{media?.name.replace(/\.[^.]+$/, '') || '새 프로젝트'}</span>{unsaved && <i title="저장하지 않은 편집" className="unsaved-dot" />}<ChevronDown size={13} /></div>
      <div className="header-actions"><span className={`local-status ${engineError ? 'error-status' : ''}`}><i />{engineError ? '엔진 확인 필요' : '내 컴퓨터에서 처리'}</span><button className="button ghost compact" onClick={saveProject} disabled={!media || !!busy}><Save size={15} />프로젝트 저장</button><button className="button primary" onClick={() => run('export')} disabled={!media || !kept.length || !!busy || !media.audioTracks.length}><ArrowUpFromLine size={16} />내보내기</button></div>
    </header>
    <div className="editor-shell">
      <nav className="tool-rail" aria-label="앱 메뉴"><button className="rail-button active" title="영상 편집" aria-label="영상 편집"><Scissors size={21} /><span>편집</span></button><button className="rail-button" title="AI 편집 도우미" aria-label="AI 편집 도우미" onClick={() => setAIOpen(true)} disabled={!ready || !!busy}><Sparkles size={20} /><span>AI</span></button><div className="rail-bottom"><button className="rail-button" onClick={() => setDialog('engine')} title="로컬 엔진" aria-label="로컬 엔진"><Settings2 size={19} /></button><button className="rail-button" onClick={() => setDialog('help')} title="사용 방법" aria-label="사용 방법"><CircleHelp size={19} /></button><span className="avatar">H</span></div></nav>
      <aside className="media-panel"><div className="panel-heading"><h2>프로젝트</h2><button className="icon-button" onClick={chooseVideo} disabled={!!busy || !ready} title="영상 추가" aria-label="영상 추가"><Plus size={17} /></button></div>
        <button className="button import-button" onClick={chooseVideo} disabled={!!busy || !ready}><FolderOpen size={16} />영상 불러오기<span>⌘ O</span></button>
        <button className="text-button project-open" onClick={() => projectInput.current?.click()} disabled={!!busy}><FolderOpen size={13} />저장한 프로젝트 열기</button>
        {pendingName && <div className="pending-project"><strong>원본 다시 연결</strong><p>{pendingName}</p><button className="text-button" onClick={chooseVideo}>원본 선택 →</button><button className="text-button" onClick={() => { pendingProject.current = null; setPendingName(''); }}>연결 취소</button></div>}
        <div className="section-label">미디어 <span>{media ? '01' : '00'}</span></div>
        {media ? <div className="media-card"><div className="media-thumbnail"><FileVideo2 size={30} /><span>{formatTime(media.duration)}</span></div><strong title={media.name}>{media.name}</strong><p>{media.width} × {media.height}<span>·</span>{formatSize(media.size)}</p><div className="media-tag"><i />원본 보존됨</div></div> : <div className="media-empty"><FileVideo2 size={25} /><p>영상을 불러오면<br />이곳에 표시됩니다.</p></div>}
        <div className="cuts-heading"><div className="section-label">발견한 무음 <span>{String(cuts.length).padStart(2, '0')}</span></div>{cuts.length > 0 && <button className="text-button" disabled={!!busy} onClick={() => edit(cuts.map(x => ({ ...x, enabled: !activeCuts })))}>{activeCuts ? '전체 복원' : '전체 제거'}</button>}</div>
        <div className="cut-list">{cuts.length ? cuts.map((cut, index) => <div key={cut.id} className={`cut-row ${selected === cut.id ? 'selected' : ''} ${!cut.enabled ? 'restored-row' : ''}`}><button className="cut-select" onClick={() => { setSelected(cut.id); seekSource(Math.max(0, cut.start - 0.5)); }}><span className="cut-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{formatTime(cut.start, true)}</strong><small>{(cut.end - cut.start).toFixed(2)}초 · {cut.enabled ? '제거' : '복원됨'}</small></span></button><button className="icon-button" onClick={() => toggleCut(cut.id)} disabled={!!busy} aria-label={`무음 ${index + 1} ${cut.enabled ? '복원' : '제거'}`} title={cut.enabled ? '구간 복원' : '다시 제거'}>{cut.enabled ? <RotateCcw size={14} /> : <Scissors size={14} />}</button></div>) : <div className="cuts-empty"><AudioLines size={22} /><p>무음 분석 후<br />편집할 구간을 확인하세요.</p></div>}</div>
        <div className="privacy-note"><ShieldCheck size={15} /><span>영상은 이 컴퓨터에 머뭅니다.</span></div>
      </aside>
      <main className="main-editor">
        <div className="compact-project-actions"><button className="text-button" onClick={chooseVideo} disabled={!!busy || !ready}><FolderOpen size={14} />영상 열기</button><button className="text-button" onClick={saveProject} disabled={!media || !!busy}><Save size={14} />프로젝트 저장</button><button className="text-button" onClick={() => projectInput.current?.click()} disabled={!!busy}><FolderOpen size={14} />프로젝트 열기</button><button className="text-button" onClick={() => setAIOpen(true)} disabled={!ready || !!busy}><Sparkles size={14} />AI 도움</button></div>
        <div className="preview-toolbar"><div className="view-title"><Monitor size={15} /><span>미리보기</span></div><div className="mode-switch"><button className={mode === 'original' ? 'selected' : ''} onClick={() => { setMode('original'); video.current?.pause(); }} disabled={!media}>원본</button><button className={mode !== 'original' ? 'selected' : ''} onClick={() => { setMode(rendered ? 'rendered' : 'edited'); video.current?.pause(); }} disabled={!media}>편집본</button></div><button className="icon-button" aria-label="전체 화면" disabled={!media} onClick={() => video.current?.requestFullscreen()}><Maximize2 size={15} /></button></div>
        <div className={`preview-stage ${dragging ? 'dragging' : ''}`} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); const file = e.dataTransfer.files[0]; if (file) void importFile(file); }}>
          {media ? <><video ref={video} src={videoSrc} playsInline preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} onTimeUpdate={() => { const t = video.current?.currentTime ?? 0; setTime(mode === 'rendered' ? editedToSource(t, kept) : t); }} onError={() => setError('미리보기 재생에 실패했습니다. 다른 H.264 영상을 선택하거나 엔진 상태를 확인해 주세요.')} /><div className="preview-badge"><i />{mode === 'original' ? '원본 영상' : mode === 'rendered' ? '렌더링된 편집본' : '컷 미리보기'}</div>{media.name === 'HyperCut 검증 샘플.mp4' && <span className="synthetic-badge">합성 검증 샘플 · 실제 음성 아님</span>}</> : <div className="empty-stage"><div className="empty-art"><span /><AudioLines size={48} strokeWidth={1.2} /><div className="art-cut"><Scissors size={16} /></div></div><span className="eyebrow">LESS EDITING. MORE CREATING.</span><h1>말은 그대로,<br /><em>쉼만 가볍게.</em></h1><p>영상을 넣고 무음 구간을 한 번에 정리하세요.<br />반복되는 컷편집은 HyperCut에 맡겨두세요.</p><button className="button primary large" onClick={chooseVideo} disabled={!!busy || !ready || !!engineError}><Plus size={18} />영상 불러오기</button><span className="drop-hint">또는 이곳에 끌어놓기 · MP4, MOV / H.264</span><button className="text-button demo-button" onClick={loadDemo} disabled={!!busy || !ready || !!engineError}><Play size={12} />16초 샘플로 먼저 체험하기<ArrowRight size={13} /></button></div>}
          {busy && <div className="job-overlay"><div className="job-card"><LoaderCircle size={26} className="spin" /><strong>{busy === 'import' ? (importProgress >= 1 ? '영상 정보를 확인하고 있어요' : '영상을 준비하고 있어요') : job?.stage || '작업을 준비하고 있어요'}</strong><div className="progress-track"><i style={{ width: `${busy === 'import' ? Math.max(5, importProgress * 100) : Math.max(3, (job?.progress || 0) * 100)}%` }} /></div><div className="job-foot"><span>{busy === 'import' ? '로컬 파일 처리 중' : `${Math.round((job?.progress || 0) * 100)}%`}</span>{(busy !== 'import' || importController.current) && <button className="text-button" onClick={cancel}>작업 취소</button>}</div></div></div>}
        </div>
        <div className="player-controls"><div className="playback-time">{formatTime(displayedTime, true)}<span>/ {formatTime(mode === 'original' ? media?.duration || 0 : editedDuration, true)}</span></div><div className="transport"><button className="icon-button" aria-label="처음으로" disabled={!media} onClick={() => seekSource(mode === 'original' ? 0 : kept[0]?.start ?? 0)}><SkipBack size={16} /></button><button className="play-button" onClick={togglePlay} aria-label={playing ? '일시 정지' : '재생'} disabled={!media}>{playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}</button><button className="icon-button" aria-label="5초 앞으로" disabled={!media} onClick={() => seekSource(time + 5)}><ArrowRight size={16} /></button></div><button className="text-button render-preview" onClick={() => run('preview')} disabled={!media || !!busy || !kept.length || !media.audioTracks.length}><Monitor size={13} />정확한 미리보기</button></div>
        <div className="timeline-panel"><div className="timeline-toolbar"><div className="timeline-title"><AudioLines size={16} />타임라인 <span>원본 시간 기준</span></div><div className="timeline-actions"><button className="icon-button" aria-label="타임라인 축소" title="타임라인 축소" disabled={timelineZoom === 1} onClick={() => setTimelineZoom(z => z / 2)}>−</button><span className="zoom-label">{timelineZoom}×</span><button className="icon-button" aria-label="타임라인 확대" title="타임라인 확대" disabled={!media || timelineZoom === 128} onClick={() => setTimelineZoom(z => z * 2)}>+</button><span className="divider" /><button className="text-button" disabled={!activeCuts || !!busy} onClick={() => setRestoreOpen(true)}><RotateCcw size={13} />일부 구간 복원</button><span className="divider" /><button className="icon-button" disabled={!history.past.length || !!busy} onClick={() => { dispatch({ type: 'undo' }); setUnsaved(true); }} aria-label="실행 취소"><Undo2 size={16} /></button><button className="icon-button" disabled={!history.future.length || !!busy} onClick={() => { dispatch({ type: 'redo' }); setUnsaved(true); }} aria-label="다시 실행"><Redo2 size={16} /></button><span className="divider" /><span className="timeline-legend"><i />제거할 구간</span></div></div>
          <Timeline zoom={timelineZoom} duration={media?.duration || 0} peaks={analysis?.peaks || []} cuts={cuts} time={time} onSeek={seekSource} selected={selected} onSelect={setSelected} />
          <div className="timeline-footer">{currentCut ? <><span>선택 구간 <strong>{formatTime(currentCut.start, true)} — {formatTime(currentCut.end, true)}</strong></span><button className="text-button" disabled={!!busy} onClick={() => toggleCut(currentCut.id)}><RotateCcw size={12} />{currentCut.enabled ? '이 구간 복원' : '이 구간 제거'}</button></> : <span>파형을 클릭해 이동하고, 표시된 구간을 선택해 복원할 수 있습니다.</span>}</div>
        </div>
      </main>
      <aside className="settings-panel"><div className="panel-heading"><h2><Scissors size={16} />무음 자동 편집</h2><span className="small-tag">LOCAL</span></div><div className="settings-content"><p className="panel-description">듣고 싶은 말만 남기세요.<br />편집 기준은 직접 조절할 수 있어요.</p>
        <label className="field-label" htmlFor="audio-track">분석할 오디오</label><select id="audio-track" value={trackIndex} disabled={!media || !!busy || !media.audioTracks.length} onChange={e => { setTrackIndex(Number(e.target.value)); setUnsaved(true); }}>{media?.audioTracks.length ? media.audioTracks.map(track => <option key={track.index} value={track.index}>{track.label} · {track.channels === 1 ? '모노' : `${track.channels}채널`}</option>) : <option value="0">{media ? '오디오 트랙 없음' : '영상 선택 후 표시'}</option>}</select>
        <div className="settings-divider" />
        <Setting label="음량 임계값" unit="dBFS" value={settings.thresholdDb} min={-96} max={0} step={1} disabled={!!busy} onChange={v => changeSettings(s => ({ ...s, thresholdDb: v }))} hint="이 값 이하의 소리를 제거합니다." />
        <div className="threshold-scale"><span>조심스럽게</span><span>더 많이 제거</span></div>
        <Setting label="최소 무음 길이" unit="초" value={settings.minSilenceMs / 1000} min={0.05} max={5} step={0.05} disabled={!!busy} onChange={v => changeSettings(s => ({ ...s, minSilenceMs: Math.round(v * 1000) }))} hint="설정한 시간 이상 조용할 때만 잘라요." />
        <div className="settings-divider" /><div className="field-title"><span>자연스러운 연결</span><span className="subtle">말 앞뒤 여유</span></div><div className="margin-fields"><NumberField label="말 시작 전" value={settings.preRollMs} disabled={!!busy} onChange={v => changeSettings(s => ({ ...s, preRollMs: v }))} /><NumberField label="말 끝난 뒤" value={settings.postRollMs} disabled={!!busy} onChange={v => changeSettings(s => ({ ...s, postRollMs: v }))} /></div><p className="field-hint">첫 음절과 말끝이 잘리지 않도록 남겨둡니다.</p>
        <button className="reset-settings text-button" disabled={!!busy} onClick={() => changeSettings({ ...DEFAULT_SETTINGS })}><RotateCcw size={12} />기본 설정으로</button>
        <div className="settings-tip"><CircleHelp size={14} /><span>작은 목소리도 제거될 수 있어요. 분석 후 컷 경계를 미리 들어보세요.</span></div>
        {stale && <div className="stale-notice">설정이 바뀌었습니다. 다시 분석하면 새 기준을 적용합니다.</div>}
        <button className="button primary analyze-button" onClick={() => run('analyze')} disabled={!media || !!busy || !media.audioTracks.length || !!engineError}><Sparkles size={17} />{analysis ? '다시 무음 분석' : '무음 분석하기'}<span>→</span></button>
        <p className="analysis-note">AI 계정 없이, 내 컴퓨터에서 분석합니다.</p>
        {media && !kept.length && <div className="stale-notice" role="status">모든 구간이 제거되어 내보낼 수 없습니다. 필요한 구간을 복원해 주세요.</div>}
        <div className="result-summary"><div className="section-label">편집 요약 <Clock3 size={13} /></div><div><span>원본 길이</span><strong>{formatTime(media?.duration || 0, true)}</strong></div><div><span>제거할 시간</span><strong className="lime">− {formatTime(removedDuration, true)} {percent > 0 && <small>{percent}%</small>}</strong></div><div className="result-total"><span>편집 후 길이</span><strong>{formatTime(editedDuration, true)}</strong></div>{cuts.length > 0 && <p>{activeCuts}개 구간 제거 · {cuts.length - activeCuts}개 복원</p>}</div>
        {output && <div className="export-ready"><div><Check size={17} /><strong>내보내기 완료</strong></div><p>{formatTime(output.duration)} · {formatSize(output.size)} · 파일 검증 완료</p><button className="button primary" onClick={downloadOutput}><Download size={15} />편집한 MP4 저장</button></div>}
      </div></aside>
    </div>
    <footer className="status-bar"><span><HardDrive size={12} />{window.hypercut ? '데스크톱 앱' : '브라우저 앱'}<i />로컬 편집</span><span>{media ? `${media.width} × ${media.height} · ${media.fps.toFixed(2)} fps` : 'H.264 · MP4 / MOV'}<span className="footer-shortcut">Space 재생 · ← → 이동 · ⌘ Z 실행 취소</span></span></footer>
    {(error || engineError) && <div className="error-toast" role="alert"><CircleHelp size={18} /><div><strong>확인이 필요합니다</strong><p>{error || engineError}</p></div><button className="icon-button" aria-label="오류 닫기" onClick={() => { setError(''); if (engineError) setDialog('engine'); }}><X size={17} /></button></div>}
    {notice && <div className="notice-toast" role="status"><Check size={16} />{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice('')}><X size={14} /></button></div>}
    {restoreOpen && media && <RestoreDialog duration={media.duration} start={currentCut?.start ?? 0} end={currentCut?.end ?? media.duration} onClose={() => setRestoreOpen(false)} onRestore={(start, end) => { setRestoreOpen(false); void run("restore", { start, end }); }} />}
    {aiOpen && <AIAssistant settings={settings} contextId={media?.id || "empty"} disabled={!!busy} onClose={() => setAIOpen(false)} onApply={next => { setSettings(next); setUnsaved(!!media); setNotice("AI 제안을 설정에 반영했습니다. 무음을 다시 분석해 주세요."); }} />}
    {dialog && <div className="modal-backdrop" onClick={() => setDialog(null)}><section className="modal" role="dialog" aria-modal="true" aria-label={dialog === 'help' ? '사용 방법' : '로컬 엔진'} onClick={e => e.stopPropagation()}><div className="panel-heading"><h2>{dialog === 'help' ? '몇 번의 클릭으로, 더 가벼운 편집' : '내 컴퓨터의 편집 엔진'}</h2><button className="icon-button" aria-label="창 닫기" onClick={() => setDialog(null)}><X size={18} /></button></div>{dialog === 'help' ? <><p><b>01.</b> H.264 MP4·MOV 영상을 불러옵니다.</p><p><b>02.</b> 음량과 최소 무음 길이를 설정하고 분석합니다.</p><p><b>03.</b> 컷을 들어보고 필요한 구간을 복원합니다.</p><p><b>04.</b> 정확한 미리보기로 확인한 뒤 MP4를 내보냅니다.</p><div className="modal-note">프로젝트 파일에는 편집 정보만 저장됩니다. 다음에 열 때 같은 원본 영상이 필요합니다. 음량 분석은 음악과 사람의 목소리를 구별하지 않으므로 마이크 트랙을 선택해 주세요.</div></> : <><p>{engineError || '영상 분석과 렌더링이 이 컴퓨터에서 실행됩니다.'}</p><div className="modal-note">현재 H.264 SDR 영상과 선택한 오디오 트랙 한 개를 지원합니다. 내보내기는 원본 파일을 변경하지 않습니다.</div>{engineError && <p>macOS에서는 FFmpeg 설치 후 앱을 다시 실행해 주세요.<code>brew install ffmpeg</code></p>}{window.hypercut && <button className="button secondary" onClick={() => window.hypercut?.openBrowser()}><Monitor size={16} />브라우저에서도 열기</button>}</>}</section></div>}
  </div>;
}

function Setting({ label, unit, value, min, max, step, disabled, onChange, hint }: { label: string; unit: string; value: number; min: number; max: number; step: number; disabled: boolean; onChange: (value: number) => void; hint: string }) {
  return <div className="setting"><div className="setting-title"><label htmlFor={label}>{label}</label><div className="value-input"><input id={label} type="number" aria-label={label} min={min} max={max} step={step} value={value} disabled={disabled} onChange={e => { const next = e.target.valueAsNumber; if (Number.isFinite(next)) onChange(Math.max(min, Math.min(max, next))); }} /><span>{unit}</span></div></div><input type="range" aria-label={`${label} 슬라이더`} min={min} max={max} step={step} value={value} disabled={disabled} style={{ '--fill': `${(value - min) / (max - min) * 100}%` } as React.CSSProperties} onChange={e => onChange(Number(e.target.value))} /><p className="field-hint">{hint}</p></div>;
}
function NumberField({ label, value, disabled, onChange }: { label: string; value: number; disabled: boolean; onChange: (value: number) => void }) {
  return <label className="number-field"><span>{label}</span><div><input type="number" min="0" max="1000" step="10" value={value} disabled={disabled} onChange={e => { if (Number.isFinite(e.target.valueAsNumber)) onChange(Math.max(0, Math.min(1000, e.target.valueAsNumber))); }} /><span>ms</span></div></label>;
}

function RestoreDialog({ duration, start, end, onClose, onRestore }: { duration: number; start: number; end: number; onClose: () => void; onRestore: (start: number, end: number) => void }) {
  const [from, setFrom] = useState(start.toFixed(3)), [to, setTo] = useState(String(Math.min(duration, Number(end.toFixed(3)))));
  const valid = from.trim() !== '' && to.trim() !== '' && Number.isFinite(Number(from)) && Number.isFinite(Number(to)) && Number(from) >= 0 && Number(to) <= duration && Number(from) < Number(to);
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-label="일부 구간 복원"><div className="panel-heading"><h2>필요한 부분만 복원하기</h2><button className="icon-button" aria-label="복원 창 닫기" onClick={onClose}><X size={18} /></button></div><p>원본 시간 기준으로 남길 범위를 입력하세요.</p><label className="ai-field">복원 시작 (초)<input type="number" min={0} max={duration} step="0.001" value={from} onChange={e => setFrom(e.target.value)} autoFocus /></label><label className="ai-field">복원 끝 (초)<input type="number" min={0} max={duration} step="0.001" value={to} onChange={e => setTo(e.target.value)} /></label><div className="modal-note">선택 범위를 포함하는 영상 프레임까지 복원합니다. 0.1초보다 짧게 남는 제거 구간도 함께 복원합니다.</div><button className="button primary" disabled={!valid} onClick={() => onRestore(Number(from), Number(to))}><RotateCcw size={15} />이 범위 복원</button></section></div>;
}
