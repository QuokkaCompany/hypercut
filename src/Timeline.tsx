import { useEffect, useMemo, useRef } from 'react';
import type { Cut } from './types';
import { formatTime } from './format';

export function Timeline({ duration, peaks, cuts, time, onSeek, selected, onSelect, zoom }: { duration: number; peaks: number[]; cuts: Cut[]; time: number; onSeek: (time: number) => void; selected: string | null; onSelect: (id: string) => void; zoom: number }) {
  const track = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const scroller = viewport.current; if (!scroller || !duration) return;
    const cut = cuts.find(cut => cut.id === selected), center = cut ? (cut.start + cut.end) / 2 : time;
    scroller.scrollLeft = center / duration * scroller.scrollWidth - scroller.clientWidth / 2;
  }, [zoom, selected, duration]);
  const seek = (clientX: number) => { const rect = track.current?.getBoundingClientRect(); if (rect && duration) onSeek(Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration))); };
  const barCount = Math.min(peaks.length, 600 * zoom);
  const bars = useMemo(() => Array.from({ length: barCount }, (_, i) => {
    const start = Math.floor(i * peaks.length / barCount), end = Math.max(start + 1, Math.floor((i + 1) * peaks.length / barCount));
    const value = Math.max(...peaks.slice(start, end));
    return Math.max(1.3, Math.pow(Math.min(1, value * 3), 0.65) * 36);
  }), [peaks, barCount]);
  const rulerDivisions = Math.min(8 * zoom, Math.max(1, Math.floor(duration * 10)));
  // Keep the heavy layers stable while progress or the playhead changes.
  const background = useMemo(() => <>
      <div className="ruler">{Array.from({ length: rulerDivisions + 1 }, (_, i) => <span key={i} style={{ left: `${i / rulerDivisions * 100}%` }}>{formatTime(duration * i / rulerDivisions, duration / rulerDivisions < 1)}</span>)}</div>
      <div className={`video-track ${duration ? 'loaded' : ''}`}><div className="film-stripes" />{duration > 0 && <span>원본 영상 <span className="subtle">· H.264</span></span>}</div>
      <div className="audio-track"><svg viewBox={`0 0 ${Math.max(1, barCount) * 2} 80`} preserveAspectRatio="none" aria-label={peaks.length ? '원본 오디오 파형' : '분석 후 파형 표시'}>{bars.map((height, i) => <rect key={i} x={i * 2} y={40 - height} width="1.2" height={height * 2} rx="0.6" />)}</svg>{!peaks.length && <span>무음 분석을 실행하면 오디오 파형이 나타납니다</span>}</div>

  </>, [duration, rulerDivisions, barCount, peaks.length, bars]);
  const cutMarkers = useMemo(() => <>
      {cuts.map(cut => <button key={cut.id} className={`timeline-cut ${cut.enabled ? 'removed' : 'restored'} ${selected === cut.id ? 'selected' : ''}`} style={{ left: `${cut.start / duration * 100}%`, width: `${(cut.end - cut.start) / duration * 100}%` }} onPointerDown={event => event.stopPropagation()} onClick={() => { onSelect(cut.id); onSeek(Math.max(0, cut.start - 0.5)); }} title={`${formatTime(cut.start)}–${formatTime(cut.end)} ${cut.enabled ? '제거' : '복원'}`} aria-label={`${formatTime(cut.start)} 구간 선택`} />)}
  </>, [cuts, duration, selected, onSelect, onSeek]);
  return <div className="timeline-body">
    <div className="track-labels"><span>시간</span><span><i className="video-dot" /> 영상</span><span><i className="audio-dot" /> 오디오</span></div>
    <div className="timeline-scroll" ref={viewport}><div className="tracks" ref={track} style={{ width: `${zoom * 100}%` }} onPointerDown={event => { if (!duration) return; event.currentTarget.setPointerCapture(event.pointerId); seek(event.clientX); }} onPointerMove={event => { if (event.buttons === 1) seek(event.clientX); }}>
      {background}
      {cutMarkers}
      {duration > 0 && <div className="playhead" style={{ left: `${Math.min(100, time / duration * 100)}%` }}><i /></div>}
    </div></div>
  </div>;
}
