import { useState } from 'react';
import { Monitor, X } from 'lucide-react';
import type { Output } from './types';
import { outputURL } from './api';
import { formatTime } from './format';

export function PreviewRangeDialog({ duration, start, end, onClose, onPreview, clip = false }: { clip?: boolean; duration: number; start: number; end: number; onClose: () => void; onPreview: (range: { start: number; end: number }) => void }) {
  const [from, setFrom] = useState(String(Math.max(0, clip ? start : Number(start.toFixed(3)))));
  const [to, setTo] = useState(String(Math.min(duration, clip ? end : Number(end.toFixed(3)))));
  const valid = from.trim() !== '' && to.trim() !== '' && Number.isFinite(Number(from)) && Number.isFinite(Number(to)) && Number(from) >= 0 && Number(to) <= duration && Number(from) < Number(to);
  return <div className="modal-backdrop" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={clip ? "클립 저장 범위" : "컷 경계 미리보기 범위"}>
    <div className="panel-heading"><h2>{clip ? "영상 클립 만들기" : "컷 경계를 확인할 범위"}</h2><button className="icon-button" aria-label="범위 창 닫기" onClick={onClose}><X size={18} /></button></div>
    <p>{clip ? "원본 영상의 시작·끝 시각을 정하세요. 이 범위 안의 현재 컷·자막·효과음을 반영합니다." : "선택한 컷의 앞뒤 2초를 기본으로 잡았습니다. 원본 시간으로 원하는 범위를 정하세요."}</p>
    <label className="ai-field">{clip ? "클립 시작 (초)" : "미리보기 시작 (초)"}<input autoFocus type="number" min={0} max={duration} step="0.001" value={from} onChange={e => setFrom(e.target.value)} /></label>
    <label className="ai-field">{clip ? "클립 끝 (초)" : "미리보기 끝 (초)"}<input type="number" min={0} max={duration} step="0.001" value={to} onChange={e => setTo(e.target.value)} /></label>
    <div className="modal-note">{clip ? "원본 해상도로 MP4를 만듭니다. 자막을 포함할 때는 문장 중간을 자르지 않도록 범위를 정하세요." : "현재 컷과 복원 내용을 적용한 짧은 영상을 만듭니다."} 프레임이 잘리지 않도록 범위가 조금 넓어질 수 있습니다.</div>
    <button className="button primary" disabled={!valid} onClick={() => onPreview({ start: Number(from), end: Number(to) })}><Monitor size={15} />{clip ? "클립 MP4 만들기" : "범위 미리보기 만들기"}</button>
  </section></div>;
}

export function RangePreviewPlayer({ output, onClose }: { output: Output; onClose: () => void }) {
  return <div className="modal-backdrop" onKeyDown={e => { if (e.key === 'Escape') onClose(); }}><section className="modal range-preview-modal" role="dialog" aria-modal="true" aria-label="컷 경계 미리보기">
    <div className="panel-heading"><h2>컷 경계 미리보기</h2><button autoFocus className="icon-button" aria-label="미리보기 창 닫기" onClick={onClose}><X size={18} /></button></div>
    <video src={outputURL(output.id)} controls playsInline preload="auto" aria-label="선택 범위 편집 영상" />
    <p className="range-preview-details">원본 {formatTime(output.sourceRange!.start, true)}–{formatTime(output.sourceRange!.end, true)}<span>편집 후 {formatTime(output.duration, true)}</span></p>
    <div className="modal-note">말의 시작과 끝, 컷이 연결되는 지점을 들어보세요. 수정하려면 이 창을 닫고 필요한 구간을 복원하세요. 전체 MP4는 메인 화면의 내보내기로 저장합니다.</div>
  </section></div>;
}
