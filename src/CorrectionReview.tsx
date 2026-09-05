import { useState } from 'react';
import { Check } from 'lucide-react';
import { correctionWarnings } from '../shared/caption-correction.mjs';
import type { CorrectionProposal } from './types';

export function CorrectionReview({ proposal, disabled, onApply }: { proposal: CorrectionProposal; disabled: boolean; onApply: (ids: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]), [acknowledged, setAcknowledged] = useState<string[]>([]);
  const toggle = (items: string[], id: string, enabled: boolean) => enabled ? [...items, id] : items.filter(item => item !== id);
  if (!proposal.changes.length) return <div className="ai-proposal" role="status">AI가 수정할 문구를 제안하지 않았습니다. 원문은 그대로입니다.</div>;
  return <div className="correction-review"><strong>원문과 비교하고 적용할 제안을 선택하세요</strong><p className="field-hint">AI는 음성을 듣지 않았습니다. 고유명사·단위·부정 표현이 원뜻을 유지하는지 확인해 주세요.</p>
    {proposal.changes.map((change, index) => { const warnings = correctionWarnings(change.before, change.after), needsAck = warnings.length > 0 && !acknowledged.includes(change.id); return <article className="correction-change" key={change.id}>
      <label className="correction-select"><input type="checkbox" aria-label={`교정 제안 ${index + 1} 적용 선택`} checked={selected.includes(change.id)} disabled={disabled || needsAck} onChange={e => setSelected(toggle(selected, change.id, e.target.checked))} />제안 {index + 1}</label>
      <div className="correction-diff"><div><span>원문</span><p>{change.before}</p></div><div><span>교정 제안</span><p>{change.after}</p></div></div><p className="correction-reason">{change.reason}</p>
      {warnings.length > 0 && <div className="correction-warning"><p>{warnings.join(' ')}</p><label><input type="checkbox" aria-label={`교정 제안 ${index + 1} 의미 확인`} checked={acknowledged.includes(change.id)} disabled={disabled} onChange={e => { setAcknowledged(toggle(acknowledged, change.id, e.target.checked)); if (!e.target.checked) setSelected(selected.filter(id => id !== change.id)); }} />원문과 부정 의미를 확인했습니다</label></div>}
    </article>; })}
    <button className="button primary" disabled={disabled || !selected.length} onClick={() => onApply(selected)}><Check size={15} />선택한 {selected.length}개 교정 적용</button><p className="field-hint">선택하지 않은 문구와 자막 시각은 유지합니다. 적용 후 자막 창에서 실행 취소할 수 있습니다.</p>
  </div>;
}
