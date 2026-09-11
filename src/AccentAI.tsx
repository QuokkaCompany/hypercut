import { useEffect, useRef, useState } from 'react';
import { accentPrompt, validateAccentRequest, validateAccentProposal } from '../shared/visual-accents.mjs';
import { request } from './api';
import type { AccentRequest, AccentProposal } from './types';

type Props = { context: string; cues: AccentRequest['cues']; disabled: boolean; onApply: (proposal: AccentProposal) => void };
export function AccentAI({ context, cues, disabled, onApply }: Props) {
  const [instruction, setInstruction] = useState('설명의 핵심 문장만 골라 자막과 부드러운 줌으로 강조해 주세요. 과한 연출은 줄여 주세요.');
  const [connection, setConnection] = useState<{ connected: boolean; provider?: string; model?: string } | null>(null);
  const [input, setInput] = useState<AccentRequest | null>(null), [proposal, setProposal] = useState<AccentProposal | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [response, setResponse] = useState(''), [prompt, setPrompt] = useState(''), [error, setError] = useState(''), [working, setWorking] = useState(false);
  const active = useRef<{ id: string; controller: AbortController } | null>(null), version = useRef(0);
  const currentContext = useRef(context); currentContext.current = context;
  useEffect(() => { const controller = new AbortController(); request<typeof connection>('/ai/connection', undefined, undefined, controller.signal).then(setConnection).catch(() => {}); return () => controller.abort(); }, []);
  function abort() { version.current++; const job = active.current; active.current = null; job?.controller.abort(); if (job) void request('/ai/accents', { requestId: job.id }, 'DELETE').catch(() => {}); }
  useEffect(() => { abort(); setInput(null); setProposal(null); setPrompt(''); setResponse(''); setWorking(false); return abort; }, [context]);
  function prepare() { return validateAccentRequest({ requestId: crypto.randomUUID(), instruction, cues }) as AccentRequest; }
  function receive(value: unknown, snapshot: AccentRequest) { const next = validateAccentProposal(value, snapshot) as AccentProposal; setProposal(next); setSelected(new Set(next.changes.map(c => c.id))); }
  async function ask() {
    const revision = ++version.current, capturedContext = context; setError(''); setProposal(null); setWorking(true);
    try {
      const snapshot = prepare(); setInput(snapshot); const controller = new AbortController(); active.current = { id: snapshot.requestId, controller };
      const value = await request('/ai/accents', snapshot, undefined, controller.signal);
      if (version.current === revision && currentContext.current === capturedContext) receive(value, snapshot);
    } catch (e) { if (version.current === revision) setError((e as Error).message); }
    finally { if (version.current === revision) { setWorking(false); active.current = null; } }
  }
  function apply() { try { onApply({ requestId: proposal!.requestId, changes: proposal!.changes.filter(c => selected.has(c.id)) }); setProposal(null); } catch (e) { setError((e as Error).message); } }
  return <section className="accent-ai" aria-label="AI 강조 제안">
    <h3>중요한 부분 제안</h3><p className="field-hint">선택한 {cues.length}문장 · 최대 20문장·4,000자. 문구와 원본 시각만 전달합니다. 제안은 선택해서 적용하세요.</p>
    <label className="ai-field">강조 요청<textarea value={instruction} maxLength={2000} disabled={working || disabled} onChange={e => { setInstruction(e.target.value); setInput(null); setProposal(null); setPrompt(''); }} /></label>
    <div className="accent-actions"><button className="button secondary" disabled={disabled || working || !cues.length} onClick={() => { try { const snapshot = prepare(); setInput(snapshot); setProposal(null); setResponse(''); const text = accentPrompt(snapshot); setPrompt(text); setError(''); void navigator.clipboard.writeText(text).catch(() => {}); } catch (e) { setError((e as Error).message); } }}>AI에게 보낼 요청 복사</button>
    <button className="button secondary" disabled={disabled || working || !connection?.connected || !cues.length} onClick={() => void ask()}>{working ? '제안 받는 중…' : '연결된 AI로 제안 받기'}</button>{working && <button className="text-button" onClick={() => { abort(); setWorking(false); setInput(null); setProposal(null); }}>AI 요청 취소</button>}</div>
    <p className="field-hint">{connection?.connected ? `사용할 연결: ${connection.provider} · ${connection.model}` : '직접 요청하려면 편집 화면의 AI 편집 도우미에서 AI를 먼저 연결하세요. 채팅에 복사해서 사용할 수도 있습니다.'}</p>
    {prompt && input && <><details><summary>보낼 요청 확인</summary><pre>{prompt}</pre></details><label className="ai-field">강조 AI JSON 응답<textarea aria-label="강조 AI JSON 응답" value={response} maxLength={131072} disabled={working} onChange={e => { setResponse(e.target.value); setProposal(null); }} /></label><button className="button secondary" disabled={disabled || working || !response.trim()} onClick={() => { try { receive(response, input); setError(''); } catch (e) { setError((e as Error).message); } }}>강조 응답 확인</button></>}
    {error && <p className="ai-error" role="alert">{error}</p>}
    {proposal && <div className="accent-proposals">{!proposal.changes.length && <p>추가로 강조할 문장이 없다는 제안입니다.</p>}{proposal.changes.map(c => <label key={c.id} className="accent-proposal"><input type="checkbox" checked={selected.has(c.id)} disabled={disabled} onChange={() => setSelected(old => { const next = new Set(old); if (next.has(c.id)) next.delete(c.id); else next.add(c.id); return next; })} /><span><strong>{cues.find(q => q.id === c.id)?.text}</strong><small>{c.reason}</small><small>{c.captionEnabled ? '강조 자막' : '자막 유지'} · {c.zoomEnabled ? `${c.zoomScale.toFixed(2)}배 줌` : '줌 없음'}</small></span></label>)}<button className="button primary" disabled={disabled || !selected.size} onClick={apply}>선택한 강조 적용</button></div>}
  </section>;
}
