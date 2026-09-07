import { cloudMode } from './api';
import { ShieldCheck } from 'lucide-react';
import type { Analysis, SpeechProtectionSettings } from './types';
import { formatTime } from './format';

export function SpeechProtection({ value, disabled, result, onChange, onSeek }: { value: SpeechProtectionSettings; disabled: boolean; result?: Analysis['protection']; onChange: (value: SpeechProtectionSettings) => void; onSeek: (time: number) => void }) {
  return <section className="speech-protection" aria-label={cloudMode ? '서버 말소리 보호' : '로컬 말소리 보호'}>
    <label className="speech-toggle"><span><ShieldCheck size={16} />말소리 보호 <small>{cloudMode ? '서버' : '로컬'}</small></span><input type="checkbox" role="switch" aria-label="말소리 보호" checked={value.enabled} disabled={disabled} onChange={e => onChange({ ...value, enabled: e.target.checked })} /></label>
    <p className="field-hint">켜면 말소리로 감지한 구간을 남깁니다. 작은 목소리를 지키는 데 도움이 되지만 놓치는 발음이 있을 수 있어요.</p>
    {value.enabled && <>
      <div className="speech-threshold"><label htmlFor="speech-threshold">음성 감지 기준</label><output>{value.threshold.toFixed(2)}</output></div>
      <input id="speech-threshold" type="range" aria-label="음성 감지 기준" min="0.1" max="0.9" step="0.05" value={value.threshold} disabled={disabled} onChange={e => onChange({ ...value, threshold: Number(e.target.value) })} />
      <p className="field-hint">낮출수록 더 많이 보존합니다. 음량 임계값과는 다른 기준이며, 분석 시간이 추가돼요.</p>
    </>}
    {result && <div className="speech-result"><strong>말소리 보호로 {result.retainedSeconds.toFixed(2)}초 추가 보존</strong><p>분석 초안 기준 · 이후 수동 편집은 제외</p><details><summary>감지한 {result.intervals.length}개 구간</summary><div className="speech-ranges">{result.intervals.slice(0, 100).map((range, index) => <button key={index} className="text-button" disabled={disabled} onClick={() => onSeek(range.start)} aria-label={`감지한 말소리 ${index + 1}로 이동`}>{formatTime(range.start)}–{formatTime(range.end)}</button>)}{result.intervals.length > 100 && <p>처음 100개 구간을 표시합니다.</p>}</div></details></div>}
  </section>;
}
