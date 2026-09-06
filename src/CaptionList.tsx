import { memo, type RefObject } from 'react';
import type { CaptionCue } from './types';
import { formatTime } from './format';
import { WindowedList } from './WindowedList';

export type MappedCue = CaptionCue & { outputStart?: number; outputEnd?: number; removed: boolean; needsReview: boolean; reviewKey: string };

type RowProps = {
  id: string; index: number; selected: boolean; start: number; end: number; text: string;
  outputStart?: number; outputEnd?: number; removed: boolean; needsReview: boolean; endWarning: boolean;
};

const CaptionRow = memo(function CaptionRow({ id, index, selected, start, end, text, outputStart, outputEnd, removed, needsReview, endWarning }: RowProps) {
  return <button className={`caption-row ${selected ? 'selected' : ''}`} data-caption-id={id} aria-label={`자막 ${index + 1} 선택`}>
    <span>{formatTime(start, true)} — {formatTime(end, true)}</span><p>{text}</p>
    <small>{removed ? '컷에서 제외됨 · 복원하면 다시 표시' : needsReview ? (endWarning ? '영상 끝 검토 필요' : '컷 경계 검토 필요') : `편집본 ${formatTime(outputStart!, true)} — ${formatTime(outputEnd!, true)}`}</small>
  </button>;
});

// The current list handles clicks while unchanged primitive row values avoid
// repeated rendering. Large lists keep visible, selected and focused rows.
export const CaptionList = memo(function CaptionList({ mapped, selected, listRef, hasTranscript, onSelect }: {
  mapped: MappedCue[]; selected?: string; listRef: RefObject<HTMLDivElement | null>;
  hasTranscript: boolean; onSelect: (cue: MappedCue) => void;
}) {
  return <WindowedList items={mapped} selected={selected} listRef={listRef} className="caption-list" label="자막 목록" estimateSize={115} onClick={event => {
    const target = (event.target as Element).closest<HTMLButtonElement>('button[data-caption-id]');
    if (!target || !event.currentTarget.contains(target)) return;
    const cue = mapped.find(item => item.id === target.dataset.captionId);
    if (cue) onSelect(cue);
  }} empty={<p className="caption-empty">{hasTranscript ? '인식된 자막이 없습니다. 전사 채널을 확인하거나 다시 전사해 주세요.' : '전사를 시작하면 문장별 자막이 표시됩니다. 모델 준비 후 인터넷 없이 사용할 수 있습니다.'}</p>}>
    {(item, index) => <CaptionRow id={item.id} index={index} selected={selected === item.id}
      start={item.start} end={item.end} text={item.text} outputStart={item.outputStart} outputEnd={item.outputEnd}
      removed={item.removed} needsReview={item.needsReview} endWarning={!!item.timingWarning} />}
  </WindowedList>;
});
