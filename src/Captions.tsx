import { CAPTION_LANGUAGES, languageLabel } from '../shared/languages.mjs';
import { applyCaptionTranslation } from '../shared/caption-translation.mjs';
import type { CaptionLanguage } from './types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Captions as CaptionsIcon, Download, LoaderCircle, Redo2, Undo2, X } from 'lucide-react';
import { mapCaptions, toSourceVTT, validateTranscript, captionContent, editCaptionContent } from '../shared/captions.mjs';
import { cloudMode, fileURL, request } from './api';
import type { CaptionCue, Job, Media, Transcript, TranscriptionSettings, CaptionStyle as Style } from './types';
import './captions.css';
import { CaptionStyle } from './CaptionStyle';
import { AIAssistant } from './AIAssistant';
import { applyCaptionCorrection, CORRECTION_LIMITS } from '../shared/caption-correction.mjs';
import { GLOSSARY_MAX_LENGTH, validateGlossary } from '../shared/glossary.mjs';
import { CaptionList, type MappedCue } from './CaptionList';

type Props = { glossary: string; onGlossaryChange: (value: string) => void; media: Media; trackIndex: number; transcript: Transcript | null; captionStyle: Style; onStyleChange: (style: Style) => void; onRenderPreview: () => void; kept: { start: number; end: number }[]; busy: boolean; job: Job | null; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onChange: (value: Transcript) => void; onTranscribe: (settings: TranscriptionSettings) => void; onExport: () => void; onExportText: (source: boolean) => void; onCreateClip: (range: { start: number; end: number }) => void; onCancel: () => void; onClose: () => void };
export function CaptionEditor({ glossary, onGlossaryChange, media, trackIndex, transcript, captionStyle, onStyleChange, onRenderPreview, kept, busy, job, canUndo, canRedo, onUndo, onRedo, onChange, onTranscribe, onExport, onExportText, onCreateClip, onCancel, onClose }: Props) {
  const track = media.audioTracks.find(x => x.index === trackIndex);
  const [status, setStatus] = useState<{ ready: boolean; error?: string; model: string } | null>(null);
  const [error, setError] = useState(''), [language, setLanguage] = useState<TranscriptionSettings['language']>(transcript?.language || 'auto'), [channel, setChannel] = useState(0);
  const [selected, setSelected] = useState<string | null>(transcript?.cues[0]?.id || null), [trackURL, setTrackURL] = useState('');
  const [textDirty, setDraftDirty] = useState(false), [glossaryDraft, setGlossaryDraft] = useState(glossary);
  const [draftRevision, setDraftRevision] = useState(0);
  const glossaryDirty = glossaryDraft !== glossary, draftDirty = textDirty || glossaryDirty;
  useEffect(() => setGlossaryDraft(glossary), [glossary]);
  useEffect(() => { const guard = (event: BeforeUnloadEvent) => { if (draftDirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard); }, [draftDirty]);
  const [targetLanguage, setTargetLanguage] = useState<CaptionLanguage>('en'), [clipEnd, setClipEnd] = useState('');
  const [correctionScope, setCorrectionScope] = useState<{ targetLanguage?: CaptionLanguage; cues: { id: string; text: string }[]; snapshot: Transcript } | null>(null);
  function leaveDraft(action: () => void) { if (!draftDirty || window.confirm('아직 적용하지 않은 자막·용어 수정을 버릴까요? 남기려면 해당 적용 버튼을 눌러 주세요.')) { if (draftDirty) setDraftRevision(value => value + 1); setDraftDirty(false); setGlossaryDraft(glossary); action(); } }
  const player = useRef<HTMLVideoElement>(null), cueList = useRef<HTMLDivElement>(null);
  const mapped = useMemo(() => mapCaptions(transcript, kept) as MappedCue[], [transcript, kept]);
  const reviews = mapped.filter(cue => cue.needsReview).length;
  const mismatch = !!transcript && transcript.trackIndex !== trackIndex;
  const cue = transcript?.cues.find(x => x.id === selected) || transcript?.cues[0];
  const content = cue ? captionContent(cue, transcript?.outputLanguage) : null;
  const translationMissing = transcript?.cues.filter(c => captionContent(c, targetLanguage).translationMissing).length || 0;
  const mappedCue = mapped.find(x => x.id === cue?.id);
  const correctionBatch: { id: string; text: string }[] = []; let correctionSize = 0;
  for (const item of (transcript?.cues || []).slice(Math.max(0, transcript?.cues.findIndex(x => x.id === cue?.id) ?? 0))) { if (correctionBatch.length >= CORRECTION_LIMITS.cues || correctionSize + item.text.length > CORRECTION_LIMITS.characters) break; correctionBatch.push({ id: item.id, text: item.text }); correctionSize += item.text.length; }
  async function refresh() { setError(''); try { setStatus(await request('/transcription/status')); } catch (e) { setError((e as Error).message); } }
  useEffect(() => { const controller = new AbortController(); request<{ ready: boolean; error?: string; model: string }>('/transcription/status', undefined, undefined, controller.signal).then(setStatus).catch(e => { if (!controller.signal.aborted) setError(e.message); }); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!transcript?.cues.length || mismatch) { setTrackURL(''); return; }
    let url = '';
    try { url = URL.createObjectURL(new Blob([toSourceVTT(transcript, media.duration)], { type: 'text/vtt' })); setTrackURL(url); }
    catch { setTrackURL(''); }
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [transcript, media.duration, mismatch]);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) { event.preventDefault(); leaveDraft(onClose); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [busy, onClose, draftDirty, glossary]);
  function change(next: Transcript) { try { onChange(validateTranscript(next, media.duration) as Transcript); setError(''); return true; } catch (e) { setError((e as Error).message); return false; } }
  function select(next: CaptionCue) { leaveDraft(() => { setSelected(next.id); if (player.current) player.current.currentTime = next.start; requestAnimationFrame(() => cueList.current?.querySelector('.caption-row.selected')?.scrollIntoView({ block: 'nearest' })); }); }
  if (correctionScope) return <AIAssistant contextId={JSON.stringify([media.id, trackIndex, transcript, kept, glossary])} disabled={busy || mismatch || transcript !== correctionScope.snapshot} onClose={() => setCorrectionScope(null)} captionTask={{ targetLanguage: correctionScope.targetLanguage, glossary, cues: correctionScope.cues, onApply: (input, proposal, ids) => { if (transcript !== correctionScope.snapshot) throw new Error('자막이 바뀌었습니다. 교정 창을 다시 열어 주세요.'); const next = (correctionScope.targetLanguage ? applyCaptionTranslation : applyCaptionCorrection)(transcript, input, proposal, ids) as Transcript; if (!change(next)) throw new Error('교정 결과를 적용할 수 없습니다. 자막을 확인해 주세요.'); } }} />;
  return <div className="modal-backdrop caption-backdrop"><section className="modal caption-modal" role="dialog" aria-modal="true" aria-label="전사와 자막 편집">
    <div className="panel-heading"><h2><CaptionsIcon size={19} />전사와 자막</h2><button className="icon-button" aria-label="자막 창 닫기" onClick={() => leaveDraft(onClose)}><X size={18} /></button></div>
    <p className="caption-intro">음성을 글로 바꾸고 문구와 시각을 다듬으세요. 원본을 들으며 확인할 수 있습니다.</p>
    <div className="caption-setup">
      <label>전사 언어<select aria-label="전사 언어" value={language} disabled={busy} onChange={e => setLanguage(e.target.value as TranscriptionSettings['language'])}><option value="auto">자동 감지</option>{CAPTION_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
      <label>전사 채널<select aria-label="전사 채널" value={channel} disabled={busy || !track} onChange={e => setChannel(Number(e.target.value))}>{Array.from({ length: Math.min(8, track?.channels || 1) }, (_, i) => <option key={i} value={i}>{i + 1}번 채널{track?.channels === 1 ? ' · 모노' : ''}</option>)}</select></label>
      <button className="button primary" disabled={busy || !status?.ready || !track} onClick={() => leaveDraft(() => { player.current?.pause(); setError(''); onTranscribe({ channel, language }); })}>{busy && job?.type === 'transcribe' ? <LoaderCircle className="spin" size={16} /> : <CaptionsIcon size={16} />}{transcript ? '다시 전사' : '음성 전사 시작'}</button>
    </div>
    <div className="caption-engine">{status?.ready ? `${status.model} · ${cloudMode ? '서버에서 전사' : '인터넷 없이 전사'}` : status?.error || (cloudMode ? '서버 전사 엔진 확인 중…' : '로컬 전사 엔진 확인 중…')}{status && !status.ready && <button className="text-button" onClick={refresh} disabled={busy}>다시 확인</button>}</div>
    {mismatch && <div className="ai-error">자막이 다른 오디오 트랙에서 만들어졌습니다. 해당 트랙으로 돌아가거나 현재 트랙을 다시 전사해 주세요.</div>}
    {busy && job && <div className="caption-progress" role="status"><span>{job.stage} · {Math.round(job.progress * 100)}%</span><button className="text-button" onClick={onCancel} disabled={job.stage === '취소 중'}>작업 취소</button></div>}
    {error && <div className="ai-error" role="alert">{error}</div>}
    <form className="project-glossary" onSubmit={event => { event.preventDefault(); try { onGlossaryChange(validateGlossary(glossaryDraft)); setError(''); } catch (e) { setError((e as Error).message); } }}>
      <label className="ai-field">프로젝트 교정 용어<textarea aria-label="프로젝트 교정 용어" value={glossaryDraft} maxLength={GLOSSARY_MAX_LENGTH} rows={2} disabled={busy} placeholder="예: 캡컶 → 캡컷, 전문 용어: 무음 구간" onChange={event => setGlossaryDraft(event.target.value)} /></label>
      <div className="glossary-actions"><p className="field-hint">AI 교정 창에 기본으로 채워집니다. 전사·자막을 자동으로 바꾸지 않습니다.<br />적용한 용어는 프로젝트 저장에 포함됩니다. {glossaryDraft.length.toLocaleString()} / 2,000자</p><button className="button secondary" disabled={busy || !glossaryDirty} type="submit">프로젝트 용어 적용</button></div>
    </form>
    {transcript && <div className="caption-language-tools">
      <label>출력 자막 언어<select aria-label="출력 자막 언어" value={transcript.outputLanguage || 'source'} disabled={busy || draftDirty || mismatch} onChange={e => change({ ...transcript, outputLanguage: e.target.value === 'source' ? undefined : e.target.value as CaptionLanguage })}><option value="source">원문 · {languageLabel(transcript.detectedLanguage || transcript.language)}</option>{CAPTION_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
      <label>번역할 언어<select aria-label="번역할 언어" value={targetLanguage} disabled={busy || draftDirty} onChange={e => setTargetLanguage(e.target.value as CaptionLanguage)}>{CAPTION_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
      <button className="button secondary" disabled={busy || draftDirty || mismatch || !correctionBatch.length} onClick={() => { player.current?.pause(); setCorrectionScope({ targetLanguage, cues: correctionBatch, snapshot: transcript }); }}>현재부터 {correctionBatch.length}개 AI 번역</button>
      <button className="text-button" disabled={busy || draftDirty || !translationMissing} onClick={() => { const next = transcript.cues.find(c => captionContent(c, targetLanguage).translationMissing); if (next) select(next); }}>다음 미번역으로 이동 · {translationMissing}개</button>
      <p className="field-hint">한 번에 최대 20개·4,000자를 번역하고 비교·선택 적용합니다. SRT·TXT·MP4는 출력 자막 언어를 사용합니다. 원본 청취 영상은 원문 자막을 표시합니다.</p>
    </div>}
    <div className="caption-workspace"><div className="caption-source">
      <video ref={player} controls preload="metadata" src={fileURL(media.id, trackIndex)} aria-label="자막 원본 청취">{trackURL && <track key={trackURL} kind="subtitles" label="원본 자막" srcLang={transcript?.language === "auto" ? transcript.detectedLanguage || "und" : transcript?.language || "und"} src={trackURL} default />}</video>
      <p className="field-hint">원본 청취 · 기본 자막 표시입니다. 디자인은 오른쪽에서 확인하세요.</p>
      {cue && <CaptionFields key={`${draftRevision}:${transcript?.outputLanguage || "source"}:${JSON.stringify(cue)}`} cue={{ ...cue, text: content!.text }} duration={media.duration} disabled={busy || mismatch} onDraftChange={setDraftDirty} onApply={next => change({ ...transcript!, cues: transcript!.cues.map(x => x.id === next.id ? { ...editCaptionContent(x, transcript!.outputLanguage, next.text), start: next.start, end: next.end } : x) })} />}
      {content?.translationMissing && <div className="caption-review">이 언어의 번역이 없거나 원문이 변경됐습니다. 번역을 생성하거나 문구를 확인해 수정 적용해 주세요. 출력 전에 반드시 확인해야 합니다.</div>}
      {transcript?.outputLanguage && cue && <p className="field-hint">원문: {cue.text}</p>}
      {mappedCue?.needsReview && !mappedCue.translationMissing && <div className="caption-review"><strong>{mappedCue.timingWarning ? '영상 끝에 걸친 자막입니다' : '컷이 이 자막을 가로지릅니다'}</strong><p>{mappedCue.timingWarning ? '끝 시각을 영상 끝에 맞췄습니다. 마지막 말과 문구가 일치하는지 원본을 듣고 확인·수정해 주세요. 컷에서 뺀 말도 문구에 남기지 마세요.' : '삭제된 말이 문구에 남지 않았는지 확인하고 수정해 주세요. 확인한 문구는 남은 시각에 한 번 표시합니다.'}</p><button className="button secondary" disabled={busy || mismatch || draftDirty} onClick={() => change({ ...transcript!, cues: transcript!.cues.map(x => x.id === cue?.id ? { ...x, reviewedFor: mappedCue.reviewKey } : x) })}>{mappedCue.timingWarning ? '문구와 영상 끝 확인 완료' : '문구와 컷 경계 확인 완료'}</button></div>}
      {cue && <button className="text-button caption-delete" disabled={busy || mismatch || draftDirty} onClick={() => change({ ...transcript!, cues: transcript!.cues.filter(x => x.id !== cue.id) })}>이 자막 삭제</button>}
      {cue && !transcript?.outputLanguage && <div className="caption-correction-actions"><button className="button secondary" disabled={busy || mismatch || draftDirty} onClick={() => { player.current?.pause(); setCorrectionScope({ cues: [{ id: cue.id, text: cue.text }], snapshot: transcript! }); }}>이 자막 AI 교정</button>{correctionBatch.length > 1 && <button className="text-button" disabled={busy || mismatch || draftDirty} onClick={() => { player.current?.pause(); setCorrectionScope({ cues: correctionBatch, snapshot: transcript! }); }}>현재부터 {correctionBatch.length}개 AI 교정</button>}<p className="field-hint">한 번에 최대 20개·4,000자. 요청 전 보낼 문구를 확인할 수 있습니다.</p></div>}
    </div><div className="caption-right"><div className="caption-list-panel"><div className="caption-list-heading"><strong>자막 {transcript?.cues.length || 0}개</strong><div><button className="icon-button" aria-label="자막 실행 취소" disabled={!canUndo || busy} onClick={() => leaveDraft(onUndo)}><Undo2 size={16} /></button><button className="icon-button" aria-label="자막 다시 실행" disabled={!canRedo || busy} onClick={() => leaveDraft(onRedo)}><Redo2 size={16} /></button></div></div>
      <CaptionList mapped={mapped} selected={cue?.id} listRef={cueList} hasTranscript={!!transcript} onSelect={select} />
    </div><CaptionStyle language={transcript?.outputLanguage || transcript?.detectedLanguage || (transcript?.language === "auto" ? undefined : transcript?.language)} value={captionStyle} media={media} text={content?.text || '자막을 더 또렷하게'} disabled={busy || draftDirty} onChange={onStyleChange} onPreview={() => leaveDraft(onRenderPreview)} /></div></div>
    {cue && transcript && <div className="caption-clip-tools"><strong>대본으로 클립 만들기</strong><p>현재 선택한 문장부터 마지막 문장까지의 원본 범위를 사용합니다.</p><label>클립 마지막 문장<select aria-label="클립 마지막 문장" value={transcript.cues.some(c => c.id === clipEnd && c.start >= cue.start) ? clipEnd : cue.id} disabled={busy || draftDirty || mismatch} onChange={e => setClipEnd(e.target.value)}>{transcript.cues.filter(c => c.start >= cue.start).map(c => <option key={c.id} value={c.id}>{c.start.toFixed(2)}초 · {captionContent(c, transcript.outputLanguage).text.slice(0, 60)}</option>)}</select></label><button className="button secondary" disabled={busy || draftDirty || mismatch} onClick={() => { player.current?.pause(); const endCue = transcript.cues.find(c => c.id === clipEnd && c.start >= cue.start) || cue; onCreateClip({ start: cue.start, end: endCue.end }); }}>선택 문장으로 클립 만들기</button></div>}
    {reviews > 0 && <button className="button secondary" disabled={busy} onClick={() => { const index = mapped.findIndex(item => item.id === cue?.id), next = mapped.slice(index + 1).find(item => item.needsReview) || mapped.find(item => item.needsReview); if (next) select(next); }}>다음 검토 자막으로 이동</button>}
    <div className="caption-text-actions"><button className="button secondary" disabled={busy || mismatch || draftDirty || !transcript?.cues.length || transcript.cues.some(c => captionContent(c, transcript.outputLanguage).translationMissing)} onClick={() => onExportText(true)}>전체 대본 TXT 저장</button><button className="button secondary" disabled={busy || mismatch || draftDirty || !!reviews || !mapped.some(c => !c.removed)} onClick={() => onExportText(false)}>편집한 대본 TXT 저장</button><p className="field-hint">전체 대본은 컷에서 제외된 문장도 포함합니다. 편집본은 남은 문장만 포함합니다.</p></div>
    <div className="caption-footer"><p>{draftDirty ? '입력한 문구·시각·용어를 적용한 뒤 저장해 주세요.' : reviews ? `${reviews}개 자막의 문구·경계를 확인해 주세요.` : captionStyle.enabled ? 'MP4 내보내기와 정확한 미리보기에 자막 디자인을 포함합니다.' : 'MP4에 자막을 넣으려면 디자인의 포함 스위치를 켜 주세요.'}<br /><small>수정한 자막은 프로젝트 저장에 포함됩니다. SRT는 글꼴·디자인을 포함하지 않습니다.</small></p><button className="button primary" disabled={busy || mismatch || draftDirty || !!reviews || !mapped.some(x => !x.removed)} onClick={onExport}><Download size={16} />편집한 SRT 저장</button></div>
  </section></div>;
}
function CaptionFields({ cue, duration, disabled, onApply, onDraftChange }: { cue: CaptionCue; duration: number; disabled: boolean; onApply: (cue: CaptionCue) => boolean; onDraftChange: (value: boolean) => void }) {
  const [text, setText] = useState(cue.text), [start, setStart] = useState(String(cue.start)), [end, setEnd] = useState(String(cue.end));
  useEffect(() => { onDraftChange(text !== cue.text || start !== String(cue.start) || end !== String(cue.end)); }, [text, start, end, cue, onDraftChange]);
  const valid = start.trim() !== '' && end.trim() !== '' && Number.isFinite(Number(start)) && Number.isFinite(Number(end)) && Number(start) >= 0 && Number(end) <= duration && Number(start) < Number(end) && !!text.trim();
  return <form className="caption-fields" onSubmit={event => { event.preventDefault(); if (valid && onApply({ ...cue, text, start: Number(start), end: Number(end), reviewedFor: undefined })) onDraftChange(false); }}><label className="ai-field">자막 문구<textarea aria-label="자막 문구" value={text} maxLength={2000} disabled={disabled} onChange={e => setText(e.target.value)} rows={3} /></label><div className="caption-times"><label>시작 (초)<input type="number" step="0.01" aria-label="자막 시작" value={start} disabled={disabled} onChange={e => setStart(e.target.value)} /></label><label>끝 (초)<input type="number" step="0.01" aria-label="자막 끝" value={end} disabled={disabled} onChange={e => setEnd(e.target.value)} /></label><button className="button secondary" disabled={disabled || !valid} type="submit">자막 수정 적용</button></div></form>;
}
