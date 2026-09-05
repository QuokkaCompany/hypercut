import { useEffect, useState } from 'react';
import type { CaptionStyle as Style, Media } from './types';
import { request } from './api';
export function CaptionStyle({ value, media, text, disabled, onChange, onPreview }: { value: Style; media: Media; text: string; disabled: boolean; onChange: (value: Style) => void; onPreview: () => void }) {
  const [preview, setPreview] = useState<{ image: string; layout: { sizePercent: number } } | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setPreview(null); setError(''); setLoading(true);
    const timer = setTimeout(() => { request<{ image: string; layout: { sizePercent: number } }>('/captions/style-preview', { mediaId: media.id, text, captionStyle: value }, undefined, controller.signal).then(result => { if (!controller.signal.aborted) { setPreview(result); setLoading(false); } }).catch(error => { if (!controller.signal.aborted) { setError(error.message); setLoading(false); } }); }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [media.id, text, value]);
  return <section className="caption-style" aria-label="자막 디자인"><div className="caption-style-heading"><strong>자막 디자인</strong><label><input type="checkbox" role="switch" aria-label="MP4에 자막 포함" checked={value.enabled} disabled={disabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} />MP4에 포함</label></div>
    <div className="caption-presets">{([['clean', '기본형'], ['box', '배경 박스'], ['emphasis', '강조형']] as const).map(([preset, label]) => <button key={preset} className={value.preset === preset ? 'selected' : ''} aria-pressed={value.preset === preset} aria-label={`자막 스타일 ${label}`} disabled={disabled} onClick={() => onChange({ ...value, preset })}><span className={`preset-${preset}`}>가나다</span>{label}</button>)}</div>
    <div className="caption-style-controls"><label>글자 크기 <span>{value.sizePercent}%</span><input aria-label="자막 글자 크기" type="range" min="2" max="8" step="0.25" value={value.sizePercent} disabled={disabled} onChange={e => onChange({ ...value, sizePercent: Number(e.target.value) })} /></label><label>위치<select aria-label="자막 위치" value={value.position} disabled={disabled} onChange={e => onChange({ ...value, position: e.target.value as Style['position'] })}><option value="bottom">아래</option><option value="top">위</option></select></label><label>가장자리 여백 <span>{value.marginPercent}%</span><input aria-label="자막 가장자리 여백" type="range" min="5" max="20" step="1" value={value.marginPercent} disabled={disabled} onChange={e => onChange({ ...value, marginPercent: Number(e.target.value) })} /></label></div>
    <div className="caption-design-preview" aria-busy={loading}>{preview ? <img src={preview.image} alt="선택한 자막 디자인 미리보기" /> : <span>{loading ? '스타일 확인 중…' : '미리보기를 만들 수 없습니다.'}</span>}</div>
    {error && <p className="ai-error" role="alert">{error}</p>}
    <p className="field-hint">긴 문구는 최대 3줄로 맞추며 크기를 줄일 수 있습니다.{preview && preview.layout.sizePercent < value.sizePercent - .01 && ` 현재 ${preview.layout.sizePercent.toFixed(2)}%로 조절했습니다.`}</p>
    <button className="button secondary" disabled={disabled || loading || !preview || !value.enabled || !!error} onClick={onPreview}>영상에 합성해 미리보기</button>
  </section>;
}
