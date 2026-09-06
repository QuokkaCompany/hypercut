import { useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import { AIAssistant } from './AIAssistant';
import type { EffectAIContext, Effects, CaptionCue } from './types';
import { buildEffectScope, applyEffectProposal } from '../shared/effect-proposal.mjs';
import { formatTime } from './format';
import './captions.css';

type State = { contextId: string; effects: Effects; duration: number; kept: { start: number; end: number }[]; cues: CaptionCue[] };
export function EffectAI({ state, contextId, connected, onApply, onClose }: { state: State; contextId: string; connected: Set<string>; onApply: (value: Effects) => void; onClose: () => void }) {
  const [assetIds, setAssetIds] = useState<string[]>([]), [clipIds, setClipIds] = useState<string[]>([]), [cueIds, setCueIds] = useState<string[]>([]);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({}), [error, setError] = useState(''), [page, setPage] = useState(0);
  const [scope, setScope] = useState<ReturnType<typeof buildEffectScope> | null>(null);
  const toggle = (items: string[], id: string, checked: boolean) => checked ? [...items, id] : items.filter(x => x !== id);
  if (scope && scope.snapshot !== JSON.stringify(state)) return <div className="modal-backdrop"><section className="modal effects-modal" role="dialog" aria-modal="true" aria-label="효과음 AI 대상 변경"><header><h2>편집 내용이 변경되었습니다</h2><button className="icon-button" aria-label="효과음 AI 선택 닫기" onClick={onClose}><X size={20} /></button></header><p className="effects-help">현재 편집과 달라 이전 제안을 적용할 수 없습니다. 현재 영상·트랙·컷·효과음·자막을 기준으로 보낼 항목을 다시 선택해 주세요.</p><button className="button primary" onClick={() => { setScope(null); setAssetIds([]); setClipIds([]); setCueIds([]); setDescriptions({}); setPage(0); setError(''); }}>현재 편집에서 다시 선택</button></section></div>;
  if (scope) return <AIAssistant contextId={JSON.stringify([contextId, state])} disabled={false} effectsTask={{ context: scope.context as EffectAIContext, onApply: (request, proposal, ids) => onApply(applyEffectProposal(state, scope, request, proposal, ids) as Effects) }} onClose={onClose} />;
  return <div className="modal-backdrop"><section className="modal effects-modal effect-ai-scope" role="dialog" aria-modal="true" aria-labelledby="effect-ai-title">
    <header><div><h2 id="effect-ai-title"><Sparkles size={20} />AI에 보낼 효과음 정보</h2><p>음원과 수정할 클립을 선택하세요. 필요한 자막만 참고 자료로 보낼 수 있습니다.</p></div><button className="icon-button" aria-label="효과음 AI 선택 닫기" onClick={onClose}><X size={20} /></button></header>
    <p className="effects-help">파일명·경로·음원 자체는 보내지 않습니다. AI는 별칭과 아래 설명을 참고합니다. 영상 길이와 유지 구간, 선택한 클립·자막의 원본 시각을 함께 전달합니다.</p>
    <h3>사용할 음원 · {assetIds.length}/8</h3>
    <div className="effect-ai-assets">{state.effects.assets.map((asset, index) => <div key={asset.id}>
      <label><input aria-label={`AI 음원 ${index + 1} 선택`} type="checkbox" checked={assetIds.includes(asset.id)} disabled={!connected.has(asset.id) || (!assetIds.includes(asset.id) && assetIds.length >= 8)} onChange={e => { setAssetIds(toggle(assetIds, asset.id, e.target.checked)); if (!e.target.checked) setClipIds(clipIds.filter(id => state.effects.clips.find(c => c.id === id)?.assetId !== asset.id)); }} />{asset.name} · {asset.duration.toFixed(2)}초 {!connected.has(asset.id) && '· 먼저 재연결 필요'}</label>
      {assetIds.includes(asset.id) && <label className="ai-field">AI에 보낼 음원 설명<input aria-label={`AI 음원 ${index + 1} 설명`} maxLength={300} value={descriptions[asset.id] || ''} placeholder="예: 부드러운 알림음, 짧은 탭 소리" onChange={e => setDescriptions({ ...descriptions, [asset.id]: e.target.value })} /></label>}
    </div>)}</div>
    <h3>수정·삭제를 허용할 기존 클립 · {clipIds.length}/32</h3>
    <p className="field-hint">선택하지 않은 클립은 AI가 수정하거나 삭제할 수 없습니다. 새 배치만 원하면 비워 두세요.</p>
    <div className="effect-ai-options">{state.effects.clips.map((clip, index) => <label key={clip.id}><input aria-label={`AI 클립 ${index + 1} 선택`} type="checkbox" checked={clipIds.includes(clip.id)} disabled={!assetIds.includes(clip.assetId) || (!clipIds.includes(clip.id) && clipIds.length >= 32)} onChange={e => setClipIds(toggle(clipIds, clip.id, e.target.checked))} />클립 {index + 1} · {state.effects.assets.find(a => a.id === clip.assetId)?.name} · 원본 {formatTime(clip.start, true)} · {clip.gainDb} dB{clip.muted ? ' · 음소거' : ''}</label>)}</div>
    <h3>참고할 자막 · {cueIds.length}/20</h3><p className="field-hint">선택한 문구와 시각만 전송합니다. 자막은 수정하지 않습니다. 최대 4,000자.</p>
    <div className="effect-ai-options">{state.cues.slice(page * 20, page * 20 + 20).map((cue, index) => <label key={cue.id}><input aria-label={`AI 참고 자막 ${page * 20 + index + 1} 선택`} type="checkbox" checked={cueIds.includes(cue.id)} disabled={!cueIds.includes(cue.id) && cueIds.length >= 20} onChange={e => setCueIds(toggle(cueIds, cue.id, e.target.checked))} /><span>{formatTime(cue.start, true)} · {cue.text}</span></label>)}{!state.cues.length && <p>현재 오디오 트랙의 자막이 없습니다. 자막 없이도 배치 시각을 직접 지시할 수 있습니다.</p>}</div>
    {state.cues.length > 20 && <div className="effects-toolbar"><button className="text-button" disabled={!page} onClick={() => setPage(page - 1)}>이전 자막</button><span>{page + 1}/{Math.ceil(state.cues.length / 20)}</span><button className="text-button" disabled={(page + 1) * 20 >= state.cues.length} onClick={() => setPage(page + 1)}>다음 자막</button><button className="text-button" disabled={!cueIds.length} onClick={() => setCueIds([])}>자막 선택 해제</button></div>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    <footer><p>이 단계에서는 AI를 호출하지 않습니다. 다음 화면에서 연결과 지시를 정하고 요청합니다.</p><button className="button primary" disabled={!assetIds.length} onClick={() => { try { setScope(buildEffectScope(state, { assetIds, clipIds, cueIds, descriptions })); setError(''); } catch (e) { setError((e as Error).message); } }}>선택 정보로 요청 준비</button></footer>
  </section></div>;
}
