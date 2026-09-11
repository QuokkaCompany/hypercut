import { useRef, useState } from 'react';
import { Redo2, Sparkles, Undo2, X } from 'lucide-react';
import { accentForCue, accentNeedsReview, validateVisualAccents } from '../shared/visual-accents.mjs';
import { captionContent } from '../shared/captions.mjs';
import type { CaptionCue, Media, Transcript, VisualAccent, CaptionStyle, AccentProposal } from './types';
import { fileURL } from './api';
import { AccentAI } from './AccentAI';
import './visual-accents.css';

type Props = { media: Media; trackIndex: number; transcript: Transcript | null; value: VisualAccent[]; initialCue?: string; context: string; captionStyle: CaptionStyle; disabled: boolean; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onChange: (value: VisualAccent[]) => void; onEnableCaptions: () => void; onPreview: (range: { start: number; end: number }) => void; onClose: () => void };
export function VisualAccents({ media, trackIndex, transcript, value, initialCue, context, captionStyle, disabled, canUndo, canRedo, onUndo, onRedo, onChange, onEnableCaptions, onPreview, onClose }: Props) {
  const [selected, setSelected] = useState(initialCue || transcript?.cues[0]?.id || '');
  const [error, setError] = useState('');
  const video = useRef<HTMLVideoElement>(null);
  const cue = transcript?.cues.find(c => c.id === selected) || transcript?.cues[0];
  const accent = value.find(a => a.cueId === cue?.id);
  const stale = value.filter(a => accentNeedsReview(a, transcript));
  const mismatch = !!transcript && trackIndex !== transcript.trackIndex;
  const locked = disabled || mismatch;
  const batch = []; let chars = 0;
  for (const c of (transcript?.cues || []).slice(Math.max(0, transcript?.cues.findIndex(c => c.id === cue?.id) ?? 0))) {
    if (batch.length === 20 || chars + c.text.length > 4000) break;
    batch.push({ id: c.id, text: c.text, start: c.start, end: c.end }); chars += c.text.length;
  }
  function change(next: VisualAccent[]) { try { onChange(validateVisualAccents(next, media.duration) as VisualAccent[]); setError(''); } catch (e) { setError((e as Error).message); } }
  function attach(c: CaptionCue, old?: VisualAccent) { try { const a = accentForCue(c, transcript, old) as VisualAccent; change([...value.filter(v => v.cueId !== c.id && v.id !== a.id), a]); } catch (e) { setError((e as Error).message); } }
  function update(patch: Partial<VisualAccent>) { if (accent) change(value.map(a => a.id === accent.id ? { ...a, ...patch } : a)); }
  function applyProposal(proposal: AccentProposal) {
    let next = [...value];
    for (const p of proposal.changes) {
      const c = transcript?.cues.find(c => c.id === p.id); if (!c || locked) throw new Error('문장 상태가 바뀌었습니다. 다시 제안해 주세요.');
      const previous = next.find(a => a.cueId === c.id);
      const a = accentForCue(c, transcript, previous) as VisualAccent;
      next = [...next.filter(a => a.cueId !== c.id), { ...a, captionEnabled: p.captionEnabled, zoomEnabled: p.zoomEnabled, zoomScale: p.zoomScale }];
    }
    onChange(validateVisualAccents(next, media.duration) as VisualAccent[]);
  }
  return <div className="modal-backdrop"><section className="modal visual-accent-modal" role="dialog" aria-modal="true" aria-label="문장 강조와 줌">
    <div className="panel-heading"><h2><Sparkles size={20} />문장 강조와 줌</h2><div className="accent-actions"><button className="icon-button" aria-label="강조 실행 취소" disabled={disabled || !canUndo} onClick={onUndo}><Undo2 size={18} /></button><button className="icon-button" aria-label="강조 다시 실행" disabled={disabled || !canRedo} onClick={onRedo}><Redo2 size={18} /></button><button className="icon-button" aria-label="강조 창 닫기" onClick={onClose}><X size={18} /></button></div></div>
    <p>중요한 문장을 골라 또렷하게 보여 주세요. 무음 편집을 바꿔도 강조는 원본 문장을 따라갑니다.</p>
    {error && <p className="ai-error" role="alert">{error}</p>}
    {mismatch && <p className="ai-error">자막을 만든 오디오 트랙으로 돌아가거나 현재 트랙을 다시 전사해 주세요.</p>}
    {stale.length > 0 && <section className="accent-stale"><strong>변경된 문장 {stale.length}개를 확인해 주세요.</strong>{stale.map(a => <div key={a.id}><span>{a.text}</span><div className="accent-actions"><button className="text-button" disabled={locked || !transcript?.cues.some(c => c.id === a.cueId)} onClick={() => attach(transcript!.cues.find(c => c.id === a.cueId)!, a)}>현재 문장으로 다시 연결</button><button className="text-button" disabled={disabled} onClick={() => change(value.filter(v => v.id !== a.id))}>강조 제거</button></div></div>)}</section>}
    {!cue ? <p className="modal-note">먼저 ‘전사와 자막’에서 문장을 만들어 주세요.</p> : <>
      <div className="accent-workspace"><div><video ref={video} src={fileURL(media.id, trackIndex)} controls playsInline preload="metadata" aria-label="강조 원본 확인" /><p className="field-hint">원본 영상입니다. 적용한 자막과 줌은 ‘강조 구간 미리보기’에서 확인하세요.</p>
      <label className="ai-field">강조할 문장<select aria-label="강조할 문장" value={cue.id} disabled={disabled} onChange={e => { setSelected(e.target.value); const c = transcript?.cues.find(c => c.id === e.target.value); if (c && video.current) video.current.currentTime = c.start; }}>{transcript?.cues.map(c => <option key={c.id} value={c.id}>{c.start.toFixed(2)}초 · {c.text.slice(0, 80)}</option>)}</select></label>
      <blockquote>{captionContent(cue, transcript?.outputLanguage).text}</blockquote><p className="field-hint">원본 {cue.start.toFixed(2)}–{cue.end.toFixed(2)}초 · 강조 {value.length}/200개</p>
      {!accent ? <button className="button primary" disabled={locked} onClick={() => attach(cue)}>이 문장에 강조 추가</button> : <button className="text-button" disabled={disabled} onClick={() => change(value.filter(a => a.id !== accent.id))}>이 문장의 강조 제거</button>}
      </div><div className="accent-controls">
      {accent ? <fieldset disabled={locked || accentNeedsReview(accent, transcript)}><legend>문장 연출</legend>
        <label className="accent-toggle"><input type="checkbox" checked={accent.captionEnabled} onChange={e => update({ captionEnabled: e.target.checked })} />강조 자막</label>
        <label className="accent-toggle"><input type="checkbox" checked={accent.zoomEnabled} onChange={e => update({ zoomEnabled: e.target.checked })} />부드러운 줌</label>
        <label className="ai-field">줌 배율 · {accent.zoomScale.toFixed(2)}배<input aria-label="줌 배율" type="range" min="1" max="1.15" step="0.01" value={accent.zoomScale} disabled={!accent.zoomEnabled} onChange={e => update({ zoomScale: Number(e.target.value) })} /></label>
        <label className="ai-field">초점 가로 · {Math.round(accent.focusX * 100)}%<input aria-label="줌 초점 가로" type="range" min="0" max="1" step="0.01" value={accent.focusX} disabled={!accent.zoomEnabled} onChange={e => update({ focusX: Number(e.target.value) })} /></label>
        <label className="ai-field">초점 세로 · {Math.round(accent.focusY * 100)}%<input aria-label="줌 초점 세로" type="range" min="0" max="1" step="0.01" value={accent.focusY} disabled={!accent.zoomEnabled} onChange={e => update({ focusY: Number(e.target.value) })} /></label>
      </fieldset> : <p className="modal-note">강조를 추가하면 자막과 줌을 각각 조절할 수 있습니다.</p>}
      {!captionStyle.enabled && <div className="modal-note">현재 MP4 자막 포함이 꺼져 있습니다.<button className="text-button" disabled={disabled} onClick={onEnableCaptions}>MP4 자막 포함 켜기</button></div>}
      <button className="button secondary" disabled={locked} onClick={() => { video.current?.pause(); onPreview({ start: Math.max(0, cue.start - 1), end: Math.min(media.duration, cue.end + 1) }); }}>강조 구간 미리보기</button><p className="field-hint">실제로 인코딩한 영상으로 확인합니다. 컷에 걸린 자막은 ‘전사와 자막’에서 문구와 경계 확인이 필요할 수 있습니다.</p>
      </div></div>
      <AccentAI context={JSON.stringify([context, batch])} cues={batch} disabled={locked} onApply={applyProposal} />
    </>}
  </section></div>;
}
