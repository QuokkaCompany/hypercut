import { useEffect, useRef, useState } from 'react';
import { Music2, Plus, Redo2, Undo2, X } from 'lucide-react';
import type { Effects, EffectAsset, EffectClip } from './types';
import { mapEffects, validateEffects, EFFECT_LIMITS } from '../shared/effects.mjs';
import { uploadEffect } from './api';
import { formatTime } from './format';
import './effects.css';

interface Props {
  value: Effects; duration: number; time: number; kept: { start: number; end: number }[]; connected: Set<string>;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  onChange: (value: Effects) => void; onConnect: (asset: EffectAsset) => void;
  onClose: () => void; onPreview: () => void; onImportBusy: (value: boolean) => void;
}
export function EffectsEditor(props: Props) {
  const { value, duration, kept, connected } = props;
  const [selected, setSelected] = useState(value.clips[0]?.id || '');
  const clip = value.clips.find(c => c.id === selected);
  const [draft, setDraft] = useState<EffectClip | null>(clip || null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null), reconnect = useRef<EffectAsset | null>(null), controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const dirty = !!clip && !!draft && JSON.stringify(clip) !== JSON.stringify(draft);
  const mapped = mapEffects(value, kept);
  useEffect(() => { setDraft(clip || null); }, [clip]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { const handler = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ''; } }; window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler); }, [dirty]);
  function change(next: Effects) { props.onChange(validateEffects(next, duration) as Effects); }
  async function imported(asset: EffectAsset) {
    const expected = reconnect.current;
    if (expected && (asset.fingerprint !== expected.fingerprint || Math.abs(asset.duration - expected.duration) > .001)) throw new Error('저장된 효과음과 다른 파일입니다. 같은 원본 음원을 선택해 주세요.');
    props.onConnect(asset);
    if (!expected) {
      if (!value.assets.some(a => a.id === asset.id) && value.assets.length >= EFFECT_LIMITS.assets) throw new Error('음원은 32개까지 추가할 수 있습니다.');
      const next = { ...value, assets: value.assets.some(a => a.id === asset.id) ? value.assets : [...value.assets, asset] };
      const created = { id: crypto.randomUUID(), assetId: asset.id, start: Math.min(Math.max(0, props.time), Math.max(0, duration - .01)), offset: 0, duration: Math.min(asset.duration, 3), gainDb: -12, muted: false };
      change({ ...next, clips: [...next.clips, created] }); setSelected(created.id);
    }
  }
  async function choose(asset: EffectAsset | null) {
    if (loading || dirty) return; reconnect.current = asset; setError('');
    if (!window.hypercut) { input.current?.click(); return; }
    setLoading(true); props.onImportBusy(true);
    try { const next = await window.hypercut.pickEffect(); if (next && mounted.current) await imported(next); }
    catch (e) { if (mounted.current) setError((e as Error).message); }
    finally { if (mounted.current) { setLoading(false); props.onImportBusy(false); } }
  }
  async function upload(file: File) {
    const active = new AbortController(); controller.current = active; setLoading(true); props.onImportBusy(true); setError('');
    try { const asset = await uploadEffect(file, active.signal); if (mounted.current) await imported(asset); }
    catch (e) { if (mounted.current) setError(active.signal.aborted ? '효과음 불러오기를 취소했습니다.' : (e as Error).message); }
    finally { if (mounted.current) { setLoading(false); props.onImportBusy(false); } controller.current = null; }
  }
  return <div className="modal-backdrop"><section className="modal effects-modal" role="dialog" aria-modal="true" aria-labelledby="effects-title">
    <header><div><h2 id="effects-title"><Music2 size={21} />효과음 편집</h2><p>원본 시각에 배치하고 편집본에서 확인하세요.</p></div><button className="icon-button" aria-label="효과음 창 닫기" disabled={dirty || loading} onClick={props.onClose}><X size={20} /></button></header>
    <input ref={input} type="file" accept=".wav,.mp3,.m4a,.aac,.flac,.ogg,audio/*" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ''; }} />
    <p className="effects-help">시작점이 삭제된 클립은 출력에서 제외됩니다. 컷을 복원하면 다시 들립니다. 효과음은 파일·설정 길이·영상 끝 중 먼저 끝나는 지점까지 재생합니다.</p>
    <div className="effects-toolbar"><button className="button primary" disabled={loading || dirty || value.clips.length >= EFFECT_LIMITS.clips} onClick={() => void choose(null)}><Plus size={16} />효과음 추가</button><button className="icon-button" aria-label="효과음 실행 취소" disabled={!props.canUndo || dirty || loading} onClick={props.onUndo}><Undo2 size={18} /></button><button className="icon-button" aria-label="효과음 다시 실행" disabled={!props.canRedo || dirty || loading} onClick={props.onRedo}><Redo2 size={18} /></button><span>{value.clips.length}개 배치 · {mapped.length}개 출력</span></div>
    {loading && <p role="status">효과음을 불러오고 있습니다.{controller.current && <button className="text-button" onClick={() => controller.current?.abort()}>불러오기 취소</button>}</p>}
    {error && <p role="alert" className="ai-error">{error}</p>}
    {value.assets.map(asset => <div className={`effects-missing ${connected.has(asset.id) ? 'connected' : ''}`} key={asset.id}><span><strong>{connected.has(asset.id) ? '연결됨' : '재연결 필요'}</strong> · {asset.name}</span><button className="text-button" disabled={dirty || loading} onClick={() => void choose(asset)} aria-label={`${asset.name} 재연결`}>음원 다시 연결</button><button className="text-button" disabled={dirty || loading} onClick={() => { change({ assets: value.assets.filter(a => a.id !== asset.id), clips: value.clips.filter(c => c.assetId !== asset.id) }); setSelected(''); }} aria-label={`${asset.name} 제외`}>음원과 클립 제외</button></div>)}
    <div className="effects-grid"><div className="effects-list">
      {!value.clips.length && <p>짧은 WAV·MP3 음원을 추가하세요.<br />모노·스테레오, 최대 5분·1 GB</p>}
      {value.clips.map((c, index) => <button key={c.id} className={`effect-item ${c.id === selected ? 'selected' : ''}`} disabled={dirty || loading} aria-label={`효과음 ${index + 1} 선택`} onClick={() => setSelected(c.id)}><strong>{value.assets.find(a => a.id === c.assetId)?.name}</strong><span>원본 {formatTime(c.start, true)} · {c.gainDb} dB</span><small>{c.muted ? '음소거' : !mapped.some(x => x.id === c.id) ? '시작점 삭제됨 · 출력 제외' : `편집본 ${formatTime(mapped.find(x => x.id === c.id)!.start, true)}`}</small></button>)}
    </div>{draft && clip && <div className="effects-fields">
      <label>원본 배치 시각 (초)<input aria-label="효과음 배치 시각" type="number" step="0.01" min="0" max={duration} value={Number.isFinite(draft.start) ? draft.start : ''} disabled={loading} onChange={e => setDraft({ ...draft, start: e.target.valueAsNumber })} /></label>
      <label>음원에서 시작할 시각 (초)<input aria-label="효과음 파일 시작" type="number" step="0.01" min="0" value={Number.isFinite(draft.offset) ? draft.offset : ''} disabled={loading} onChange={e => setDraft({ ...draft, offset: e.target.valueAsNumber })} /></label>
      <label>재생 길이 (초)<input aria-label="효과음 길이" type="number" step="0.01" min="0.01" max="300" value={Number.isFinite(draft.duration) ? draft.duration : ''} disabled={loading} onChange={e => setDraft({ ...draft, duration: e.target.valueAsNumber })} /></label>
      <label>음량 (dB)<input aria-label="효과음 음량" type="number" step="1" min="-60" max="12" value={Number.isFinite(draft.gainDb) ? draft.gainDb : ''} disabled={loading} onChange={e => setDraft({ ...draft, gainDb: e.target.valueAsNumber })} /></label>
      <label className="effects-mute"><input aria-label="효과음 음소거" type="checkbox" checked={draft.muted} disabled={loading} onChange={e => setDraft({ ...draft, muted: e.target.checked })} />이 클립 음소거</label>
      <div className="effects-toolbar"><button className="button primary" disabled={!dirty || loading} onClick={() => { try { change({ ...value, clips: value.clips.map(c => c.id === draft.id ? draft : c) }); setError(''); } catch (e) { setError((e as Error).message); } }}>효과음 수정 적용</button><button className="text-button" disabled={!dirty || loading} onClick={() => { setDraft(clip); setError(''); }}>입력 취소</button><button className="text-button" disabled={dirty || loading} onClick={() => { change({ ...value, clips: value.clips.filter(c => c.id !== clip.id) }); setSelected(''); }}>클립 삭제</button></div>
    </div>}</div>
    {dirty && <p className="stale-notice" role="status">입력한 변경을 적용하거나 취소한 뒤 다른 작업을 진행해 주세요.</p>}
    <footer><p>효과음은 ‘정확한 미리보기’와 MP4 출력에 포함됩니다. 겹쳐서 0 dBFS를 넘으면 음량을 낮춰 다시 출력하세요.</p><button className="button primary" disabled={dirty || loading || !kept.length} onClick={props.onPreview}>효과음 포함 미리보기</button></footer>
  </section></div>;
}
