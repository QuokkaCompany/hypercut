import { useRef } from 'react';
import type { Cut } from './types';
import { formatTime } from './format';

export function Timeline({ duration, peaks, cuts, time, onSeek, selected, onSelect }: { duration: number; peaks: number[]; cuts: Cut[]; time: number; onSeek: (time: number) => void; selected: string | null; onSelect: (id: string) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const seek = (clientX: number) => { const rect = track.current?.getBoundingClientRect(); if (rect && duration) onSeek(Math.max(0, Math.min(duration, (clientX - rect.left) / rect.width * duration))); };
  const bars = peaks.length ? Array.from({ length: 600 }, (_, i) => {
    const start = Math.floor(i * peaks.length / 600), end = Math.max(start + 1, Math.floor((i + 1) * peaks.length / 600));
    const value = Math.max(...peaks.slice(start, end));
    return Math.max(1.3, Math.pow(Math.min(1, value * 3), 0.65) * 36);
  }) : [];
  return <div className="timeline-body">
    <div className="track-labels"><span>시간</span><span><i className="video-dot" /> 영상</span><span><i className="audio-dot" /> 오디오</span></div>
    <div className="tracks" ref={track} onPointerDown={event => { if (!duration) return; event.currentTarget.setPointerCapture(event.pointerId); seek(event.clientX); }} onPointerMove={event => { if (event.buttons === 1) seek(event.clientX); }}>
      <div className="ruler">{Array.from({ length: 9 }, (_, i) => <span key={i} style={{ left: `${i * 12.5}%` }}>{formatTime(duration * i / 8)}</span>)}</div>
      <div className={`video-track ${duration ? 'loaded' : ''}`}><div className="film-stripes" />{duration > 0 && <span>원본 영상 <span className="subtle">· H.264</span></span>}</div>
      <div className="audio-track"><svg viewBox="0 0 1200 80" preserveAspectRatio="none" aria-label={peaks.length ? '원본 오디오 파형' : '분석 후 파형 표시'}>{bars.map((height, i) => <rect key={i} x={i * 2} y={40 - height} width="1.2" height={height * 2} rx="0.6" />)}</svg>{!peaks.length && <span>무음 분석을 실행하면 오디오 파형이 나타납니다</span>}</div>
      {cuts.map(cut => <button key={cut.id} className={`timeline-cut ${cut.enabled ? 'removed' : 'restored'} ${selected === cut.id ? 'selected' : ''}`} style={{ left: `${cut.start / duration * 100}%`, width: `${(cut.end - cut.start) / duration * 100}%` }} onPointerDown={event => event.stopPropagation()} onClick={() => { onSelect(cut.id); onSeek(Math.max(0, cut.start - 0.5)); }} title={`${formatTime(cut.start)}–${formatTime(cut.end)} ${cut.enabled ? '제거' : '복원'}`} aria-label={`${formatTime(cut.start)} 구간 선택`} />)}
      {duration > 0 && <div className="playhead" style={{ left: `${Math.min(100, time / duration * 100)}%` }}><i /></div>}
    </div>
  </div>;
}
