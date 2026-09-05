import { useEffect, useMemo, useRef, useState } from 'react';
import { Captions as CaptionsIcon, Download, LoaderCircle, Redo2, Undo2, X } from 'lucide-react';
import { mapCaptions, toSRT, validateTranscript } from '../shared/captions.mjs';
import { fileURL, request } from './api';
import type { CaptionCue, Job, Media, Transcript, TranscriptionSettings } from './types';
import { formatTime } from './format';
import './captions.css';

type MappedCue = CaptionCue & { outputStart?: number; outputEnd?: number; removed: boolean; needsReview: boolean; reviewKey: string };
type Props = { media: Media; trackIndex: number; transcript: Transcript | null; kept: { start: number; end: number }[]; busy: boolean; job: Job | null; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onChange: (value: Transcript) => void; onTranscribe: (settings: TranscriptionSettings) => void; onExport: () => void; onCancel: () => void; onClose: () => void };
export function CaptionEditor({ media, trackIndex, transcript, kept, busy, job, canUndo, canRedo, onUndo, onRedo, onChange, onTranscribe, onExport, onCancel, onClose }: Props) {
  const track = media.audioTracks.find(x => x.index === trackIndex);
  const [status, setStatus] = useState<{ ready: boolean; error?: string; model: string } | null>(null);
  const [error, setError] = useState(''), [language, setLanguage] = useState<TranscriptionSettings['language']>('ko'), [channel, setChannel] = useState(0);
  const [selected, setSelected] = useState<string | null>(transcript?.cues[0]?.id || null), [trackURL, setTrackURL] = useState('');
  const [draftDirty, setDraftDirty] = useState(false);
  function leaveDraft(action: () => void) { if (!draftDirty || window.confirm('아직 적용하지 않은 자막 수정을 닫을까요? 문구를 남기려면 자막 수정 적용을 눌러 주세요.')) { setDraftDirty(false); action(); } }
  const player = useRef<HTMLVideoElement>(null);
  const mapped = useMemo(() => mapCaptions(transcript, kept) as MappedCue[], [transcript, kept]);
  const reviews = mapped.filter(cue => cue.needsReview).length;
  const mismatch = !!transcript && transcript.trackIndex !== trackIndex;
  const cue = transcript?.cues.find(x => x.id === selected) || transcript?.cues[0];
  const mappedCue = mapped.find(x => x.id === cue?.id);
  async function refresh() { setError(''); try { setStatus(await request('/transcription/status')); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { const controller = new AbortController(); request<{ ready: boolean; error?: string; model: string }>('/transcription/status', undefined, undefined, controller.signal).then(setStatus).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!transcript?.cues.length || mismatch) { setTrackURL(''); return; }
    let url = '';
    try { const srt = toSRT(transcript, [{ start: 0, end: media.duration }]); url = URL.createObjectURL(new Blob(['WEBVTT\n\n' + srt.replace(/^(\d{2}:\d{2}:\d{2}),(\d{3}) --> (\d{2}:\d{2}:\d{2}),(\d{3})$/gm, '$1.$2 --> $3.$4')], { type: 'text/vtt' })); setTrackURL(url); }
    catch { setTrackURL(''); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [transcript, media.duration, mismatch]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); leaveDraft(onClose); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [busy, onClose, draftDirty]);
  function change(next: Transcript) { try { onChange(validateTranscript(next, media.duration) as Transcript); setError(''); return true; } catch (e) { setError((e as Error).message); return false; } }
  function select(next: CaptionCue) { leaveDraft(() => { setSelected(next.id); if (player.current) player.current.currentTime = next.start; }); }
  return <div className="modal-backdrop caption-backdrop"><section className="modal caption-modal" role="dialog" aria-modal="true" aria-label="전사와 자막 편집">
    <div className="panel-heading"><h2><CaptionsIcon size={19} />전사와 자막</h2><button className="icon-button" aria-label="자막 창 닫기" onClick={() => leaveDraft(onClose)}><X size={18} /></button></div>
    <p className="caption-intro">음성을 글로 바꾸고 문구와 시각을 다듬으세요. 원본을 들으며 확인할 수 있습니다.</p>
    <div className="caption-setup">
      <label>전사 언어<select aria-label="전사 언어" value={language} disabled={busy} onChange={e => setLanguage(e.target.value as TranscriptionSettings['language'])}><option value="ko">한국어</option><option value="en">영어</option><option value="auto">자동 감지</option></select></label>
      <label>전사 채널<select aria-label="전사 채널" value={channel} disabled={busy || !track} onChange={e => setChannel(Number(e.target.value))}>{Array.from({ length: Math.min(8, track?.channels || 1) }, (_, i) => <option key={i} value={i}>{i + 1}번 채널{track?.channels === 1 ? ' · 모노' : ''}</option>)}</select></label>
      <button className="button primary" disabled={busy || !status?.ready || !track} onClick={() => leaveDraft(() => { player.current?.pause(); setError(''); onTranscribe({ channel, language }); })}>{busy && job?.type === 'transcribe' ? <LoaderCircle className="spin" size={16} /> : <CaptionsIcon size={16} />}{transcript ? '다시 전사' : '음성 전사 시작'}</button>
    </div>
    <div className="caption-engine">{status?.ready ? `${status.model} · 인터넷 없이 전사` : status?.error || '로컬 전사 엔진 확인 중…'}{status && !status.ready && <button className="text-button" onClick={refresh} disabled={busy}>다시 확인</button>}</div>
    {mismatch && <div className="ai-error">자막이 다른 오디오 트랙에서 만들어졌습니다. 해당 트랙으로 돌아가거나 현재 트랙을 다시 전사해 주세요.</div>}
    {busy && job && <div className="caption-progress" role="status"><span>{job.stage} · {Math.round(job.progress * 100)}%</span><button className="text-button" onClick={onCancel} disabled={job.stage === '취소 중'}>작업 취소</button></div>}
    {error && <div className="ai-error" role="alert">{error}</div>}
    <div className="caption-workspace"><div className="caption-source">
      <video ref={player} controls preload="metadata" src={fileURL(media.id, trackIndex)} aria-label="자막 원본 청취">{trackURL && <track key={trackURL} kind="subtitles" label="원본 자막" srcLang="ko" src={trackURL} default />}</video>
      <p className="field-hint">원본 시간 기준 · 자동 전사의 문구와 시각은 직접 확인해 주세요.</p>
      {cue && <CaptionFields key={JSON.stringify(cue)} cue={cue} duration={media.duration} disabled={busy || mismatch} onDraftChange={setDraftDirty} onApply={next => change({ ...transcript!, cues: transcript!.cues.map(x => x.id === next.id ? next : x) })} />}
      {mappedCue?.needsReview && <div className="caption-review"><strong>컷이 이 자막을 가로지릅니다</strong><p>삭제된 말이 문구에 남지 않았는지 확인하고 수정해 주세요. 확인한 문구는 남은 시각에 한 번 표시합니다.</p><button className="button secondary" disabled={busy || mismatch || draftDirty} onClick={() => change({ ...transcript!, cues: transcript!.cues.map(x => x.id === cue?.id ? { ...x, reviewedFor: mappedCue.reviewKey } : x) })}>문구와 컷 경계 확인 완료</button></div>}
      {cue && <button className="text-button caption-delete" disabled={busy || mismatch || draftDirty} onClick={() => change({ ...transcript!, cues: transcript!.cues.filter(x => x.id !== cue.id) })}>이 자막 삭제</button>}
    </div><div className="caption-list-panel"><div className="caption-list-heading"><strong>자막 {transcript?.cues.length || 0}개</strong><div><button className="icon-button" aria-label="자막 실행 취소" disabled={!canUndo || busy} onClick={() => leaveDraft(onUndo)}><Undo2 size={16} /></button><button className="icon-button" aria-label="자막 다시 실행" disabled={!canRedo || busy} onClick={() => leaveDraft(onRedo)}><Redo2 size={16} /></button></div></div>
      <div className="caption-list">{mapped.map((item, i) => <button key={item.id} className={`caption-row ${cue?.id === item.id ? 'selected' : ''}`} aria-label={`자막 ${i + 1} 선택`} onClick={() => select(item)}><span>{formatTime(item.start, true)} — {formatTime(item.end, true)}</span><p>{item.text}</p><small>{item.removed ? '컷에서 제외됨 · 복원하면 다시 표시' : item.needsReview ? '컷 경계 검토 필요' : `편집본 ${formatTime(item.outputStart!, true)} — ${formatTime(item.outputEnd!, true)}`}</small></button>)}{!transcript?.cues.length && <p className="caption-empty">{transcript ? '인식된 자막이 없습니다. 전사 채널을 확인하거나 다시 전사해 주세요.' : '전사를 시작하면 문장별 자막이 표시됩니다. 모델 준비 후 인터넷 없이 사용할 수 있습니다.'}</p>}</div>
    </div></div>
    <div className="caption-footer"><p>{draftDirty ? '입력한 문구·시각을 적용한 뒤 저장해 주세요.' : reviews ? `${reviews}개 자막의 컷 경계를 확인해 주세요.` : '자막은 SRT로 저장합니다. 현재 MP4에는 자막이 합성되지 않습니다.'}<br /><small>수정한 자막은 프로젝트 저장에 포함됩니다. SRT는 글꼴·디자인을 포함하지 않습니다.</small></p><button className="button primary" disabled={busy || mismatch || draftDirty || !!reviews || !mapped.some(x => !x.removed)} onClick={onExport}><Download size={16} />편집한 SRT 저장</button></div>
  </section></div>;
}
function CaptionFields({ cue, duration, disabled, onApply, onDraftChange }: { cue: CaptionCue; duration: number; disabled: boolean; onApply: (cue: CaptionCue) => boolean; onDraftChange: (value: boolean) => void }) {
  const [text, setText] = useState(cue.text), [start, setStart] = useState(String(cue.start)), [end, setEnd] = useState(String(cue.end));
  useEffect(() => { onDraftChange(text !== cue.text || start !== String(cue.start) || end !== String(cue.end)); }, [text, start, end, cue, onDraftChange]);
  const valid = start.trim() !== '' && end.trim() !== '' && Number.isFinite(Number(start)) && Number.isFinite(Number(end)) && Number(start) >= 0 && Number(end) <= duration && Number(start) < Number(end) && !!text.trim();
  return <form className="caption-fields" onSubmit={event => { event.preventDefault(); if (valid && onApply({ ...cue, text, start: Number(start), end: Number(end), reviewedFor: undefined })) onDraftChange(false); }}><label className="ai-field">자막 문구<textarea aria-label="자막 문구" value={text} maxLength={2000} disabled={disabled} onChange={e => setText(e.target.value)} rows={3} /></label><div className="caption-times"><label>시작 (초)<input type="number" step="0.01" aria-label="자막 시작" value={start} disabled={disabled} onChange={e => setStart(e.target.value)} /></label><label>끝 (초)<input type="number" step="0.01" aria-label="자막 끝" value={end} disabled={disabled} onChange={e => setEnd(e.target.value)} /></label><button className="button secondary" disabled={disabled || !valid} type="submit">자막 수정 적용</button></div></form>;
}
