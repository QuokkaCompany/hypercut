import { useState } from 'react';
import type { EffectAIRequest, EffectAIProposal, EffectClip } from './types';
import { effectOutput } from '../shared/effect-proposal.mjs';
import { formatTime } from './format';
export function EffectProposalReview({ proposal, input, disabled, onApply }: { proposal: EffectAIProposal; input: EffectAIRequest; disabled: boolean; onApply: (ids: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  function details(clip: EffectClip | null) {
    if (!clip) return <p>클립 없음</p>;
    const output = effectOutput(clip, input), asset = input.assets.find(a => a.id === clip.assetId);
    return <dl className="effect-proposal-values"><dt>음원</dt><dd>{asset?.description} ({clip.assetId.replace('asset-', '음원 ')})</dd><dt>원본 배치</dt><dd>{formatTime(clip.start, true)}</dd><dt>음원 시작</dt><dd>{clip.offset.toFixed(3)}초</dd><dt>설정 길이</dt><dd>{clip.duration.toFixed(3)}초</dd><dt>음량</dt><dd>{clip.gainDb} dB · {clip.muted ? '음소거' : '재생'}</dd><dt>출력 예상</dt><dd>{clip.muted ? '음소거로 제외' : output ? `${formatTime(output.start, true)}부터 ${output.duration.toFixed(3)}초` : '시작점 삭제됨 · 출력 제외'}</dd></dl>;
  }
  if (!proposal.changes.length) return <div className="ai-proposal" role="status">AI가 효과음 변경을 제안하지 않았습니다. 기존 편집은 그대로입니다.</div>;
  return <div className="correction-review"><strong>기존 배치와 비교하고 적용할 제안을 선택하세요</strong><p className="field-hint">AI는 음원을 듣지 않았습니다. 프레임에 맞춘 최종 시각과 소리는 적용 후 정확한 미리보기에서 확인하세요. 음량 과부하는 실제 출력 시 검사합니다.</p>
    {proposal.changes.map((change, i) => <article className="correction-change" key={change.id}><label className="correction-select"><input aria-label={`효과음 제안 ${i + 1} 적용 선택`} type="checkbox" checked={selected.includes(change.id)} disabled={disabled} onChange={e => setSelected(e.target.checked ? [...selected, change.id] : selected.filter(id => id !== change.id))} />제안 {i + 1} · {{ add: '추가', update: '수정', remove: '삭제' }[change.action]}</label><div className="correction-diff"><div><span>현재</span>{details(change.before)}</div><div><span>제안</span>{details(change.after)}</div></div><p className="correction-reason">{change.reason}</p></article>)}
    <button className="button primary" disabled={disabled || !selected.length} onClick={() => onApply(selected)}>선택한 {selected.length}개 효과음 제안 적용</button><p className="field-hint">선택하지 않은 클립은 유지합니다. 효과음 창에서 한 번에 실행 취소할 수 있습니다.</p>
  </div>;
}
