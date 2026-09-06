import { memo, useRef } from 'react';
import { AudioLines, RotateCcw, Scissors } from 'lucide-react';
import type { Cut } from './types';
import { formatTime } from './format';
import { WindowedList } from './WindowedList';

type Props = {
  cuts: Cut[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string) => void;
  onSeek: (time: number) => void;
  onToggle: (id: string) => void;
};

const CutRow = memo(function CutRow({ cut, index, selected, disabled }: { cut: Cut; index: number; selected: boolean; disabled: boolean }) {
  return <div className={`cut-row ${selected ? 'selected' : ''} ${!cut.enabled ? 'restored-row' : ''}`}>
    <button className="cut-select" data-cut-action="select" data-cut-id={cut.id}>
      <span className="cut-number">{String(index + 1).padStart(2, '0')}</span>
      <span><strong>{formatTime(cut.start, true)}</strong><small>{(cut.end - cut.start).toFixed(2)}초 · {cut.enabled ? '제거' : '복원됨'}</small></span>
    </button>
    <button className="icon-button" data-cut-action="toggle" data-cut-id={cut.id} disabled={disabled} aria-label={`무음 ${index + 1} ${cut.enabled ? '복원' : '제거'}`} title={cut.enabled ? '구간 복원' : '다시 제거'}>
      {cut.enabled ? <RotateCcw size={14} /> : <Scissors size={14} />}
    </button>
  </div>;
});

// The list handles events with current callbacks; unchanged rows keep their UI.
export const CutList = memo(function CutList({ cuts, selected, disabled, onSelect, onSeek, onToggle }: Props) {
  const listRef = useRef<HTMLDivElement>(null);
  return <WindowedList items={cuts} selected={selected} listRef={listRef} className="cut-list" label="무음 구간 목록" estimateSize={54} onClick={event => {
    const button = (event.target as Element).closest<HTMLButtonElement>('button[data-cut-action]');
    if (!button || button.disabled || !event.currentTarget.contains(button)) return;
    const cut = cuts.find(value => value.id === button.dataset.cutId);
    if (!cut) return;
    if (button.dataset.cutAction === 'toggle') onToggle(cut.id);
    else { onSelect(cut.id); onSeek(Math.max(0, cut.start - 0.5)); }
  }} empty={<div className="cuts-empty"><AudioLines size={22} /><p>무음 분석 후<br />편집할 구간을 확인하세요.</p></div>}>
    {(cut, index) => <CutRow cut={cut} index={index} selected={selected === cut.id} disabled={disabled} />}
  </WindowedList>;
});
