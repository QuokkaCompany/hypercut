import { useEffect, useRef, useState } from 'react';
import { Copy, Link, Unplug } from 'lucide-react';
import { validateProposal } from '../shared/ai.mjs';
import { validateCorrectionRequest, validateCorrectionProposal } from '../shared/caption-correction.mjs';
import { validateEffectRequest, validateEffectProposal } from '../shared/effect-proposal.mjs';
import { request } from './api';
import { CorrectionReview } from './CorrectionReview';
import { EffectProposalReview } from './EffectProposalReview';
import type { Settings, CorrectionRequest, CorrectionProposal, EffectAIContext, EffectAIRequest, EffectAIProposal } from './types';

type SettingProposal = { settings: Settings; explanation: string };
type Task = { task: 'settings'; request: { instruction: string; settings: Settings } } | { task: 'correction'; request: CorrectionRequest } | { task: 'effects'; request: EffectAIRequest };
type Receipt = { shareId: string; contextVersion: string; proposalId: string | null; status: string; expiresAt: number; proposal?: unknown };
type Share = Receipt & { connection: { command: string; args: string[]; env: Record<string, string> } };
type Active = { share: Share; input: Task; key: string; generation: number };
type Review = { proposalId: string; proposal: SettingProposal | CorrectionProposal | EffectAIProposal };
type Resolution = { item: Active; body: { contextVersion: string; proposalId: string; outcome: 'applied' | 'rejected'; selectedIds: string[] } };
type Props = {
  contextKey: string; instruction: string; glossary: string; settings: Settings; disabled: boolean; onClose: () => void;
  onApply?: (settings: Settings) => void;
  captionTask?: { cues: CorrectionRequest['cues']; onApply: (input: CorrectionRequest, proposal: CorrectionProposal, ids: string[]) => void };
  effectsTask?: { context: EffectAIContext; onApply: (input: EffectAIRequest, proposal: EffectAIProposal, ids: string[]) => void };
};
const labels: Record<keyof Settings, string> = { thresholdDb: '음량 기준 (dBFS)', minSilenceMs: '최소 무음 (ms)', preRollMs: '말하기 전 (ms)', postRollMs: '말하기 후 (ms)' };

export function MCPShare(props: Props) {
  const key = JSON.stringify([props.contextKey, props.instruction, props.glossary]);
  const latest = useRef({ key, props }); latest.current = { key, props };
  const active = useRef<Active | null>(null), mounted = useRef(true), generation = useRef(0), finishing = useRef<Resolution | null>(null), revoking = useRef<string | null>(null);
  const [share, setShare] = useState<Share | null>(null), [review, setReview] = useState<Review | null>(null);
  const [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [pendingReceipt, setPendingReceipt] = useState(false), [pendingRevocation, setPendingRevocation] = useState(false);
  function release() {
    const id = active.current?.share.shareId || revoking.current; active.current = null; generation.current++;
    return id ? request<{ revoked: boolean }>(`/ai/shares/${id}`, undefined, 'DELETE', AbortSignal.timeout(5000)).then(result => { if (result.revoked !== true) throw new Error('공유 해제를 확인하지 못했습니다.'); }) : Promise.resolve();
  }
  async function revoke() {
    revoking.current ||= active.current?.share.shareId || null;
    setWorking(true); setError(''); setNotice('공유 해제를 확인하고 있습니다.'); setShare(null); setReview(null);
    try { await release(); revoking.current = null; if (mounted.current) { setPendingRevocation(false); setNotice('공유를 해제했습니다.'); } }
    catch { if (mounted.current) { setPendingRevocation(true); setNotice(''); setError('즉시 공유 해제를 확인하지 못했습니다. 다시 시도해 주세요. 상태 갱신은 중단했으며 마지막 확인에서 90초 후 만료됩니다.'); } }
    finally { if (mounted.current) setWorking(false); }
  }
  useEffect(() => {
    mounted.current = true;
    const onHide = () => { void release().catch(() => {}); }; window.addEventListener('pagehide', onHide);
    return () => { mounted.current = false; void release().catch(() => {}); window.removeEventListener('pagehide', onHide); };
  }, []);
  useEffect(() => {
    if (finishing.current) return;
    const hadShare = !!active.current; void release().catch(() => { if (mounted.current) setError('이전 공유의 즉시 해제를 확인하지 못했습니다. 마지막 상태 확인에서 90초 후 만료됩니다.'); }); setShare(null); setReview(null); setWorking(false);
    if (hadShare) setNotice('요청이나 편집 대상이 바뀌어 이전 공유 해제를 요청했습니다. 다시 공유해 주세요.');
  }, [key]);
  useEffect(() => {
    if (!share) return;
    let stopped = false, timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const item = active.current;
      if (stopped || !item || item.share.shareId !== share!.shareId) return;
      try {
        const state = await request<Receipt>(`/ai/shares/${item.share.shareId}`, undefined, undefined, AbortSignal.timeout(5000));
        if (stopped || active.current !== item || item.key !== latest.current.key) return;
        if (state.contextVersion !== item.share.contextVersion) throw new Error('공유 대상이 변경되었습니다. 다시 공유해 주세요.');
        if (state.status === 'proposed' && state.proposalId) {
          const proposal = item.input.task === 'settings' ? validateProposal(state.proposal) : item.input.task === 'correction' ? validateCorrectionProposal(state.proposal, item.input.request) : validateEffectProposal(state.proposal, item.input.request);
          setReview(previous => previous?.proposalId === state.proposalId ? previous : { proposalId: state.proposalId!, proposal });
          setNotice('AI 제안을 받았습니다. 비교한 뒤 필요한 항목만 적용하세요.');
        }
      } catch (e) {
        if (!stopped && active.current === item) { void release().catch(() => {}); setShare(null); setReview(null); setError((e as Error).message); setNotice('연결 상태를 확인한 뒤 다시 공유해 주세요.'); }
        return;
      }
      if (!stopped) timer = setTimeout(() => void poll(), 1500);
    }
    void poll(); return () => { stopped = true; clearTimeout(timer); };
  }, [share]);
  async function start() {
    void release().catch(() => {}); setShare(null); setReview(null); setError(''); setNotice(''); setWorking(true);
    const current = generation.current, currentKey = key;
    try {
      const input: Task = props.effectsTask ? { task: 'effects', request: validateEffectRequest({ ...props.effectsTask.context, requestId: crypto.randomUUID(), instruction: props.instruction }) as EffectAIRequest } : props.captionTask ? { task: 'correction', request: validateCorrectionRequest({ requestId: crypto.randomUUID(), instruction: props.instruction, glossary: props.glossary, cues: props.captionTask.cues }) as CorrectionRequest } : { task: 'settings', request: { settings: props.settings, instruction: props.instruction } };
      const created = await request<Share>('/ai/shares', input, undefined, AbortSignal.timeout(5000));
      if (!mounted.current || generation.current !== current || latest.current.key !== currentKey) { void request(`/ai/shares/${created.shareId}`, undefined, 'DELETE').catch(() => {}); return; }
      active.current = { share: created, input, key: currentKey, generation: current }; setShare(created); setNotice('공유 중 · 외부 AI의 제안을 기다립니다.');
    } catch (e) { if (mounted.current && generation.current === current) setError((e as Error).message); }
    finally { if (mounted.current && generation.current === current) setWorking(false); }
  }
  async function sendReceipt(resolution: Resolution) {
    if (mounted.current) { setWorking(true); setError(''); }
    try {
      await request(`/ai/shares/${resolution.item.share.shareId}/resolution`, resolution.body, undefined, AbortSignal.timeout(5000));
      finishing.current = null;
      if (mounted.current) { setPendingReceipt(false); setShare(null); setReview(null); setNotice(resolution.body.outcome === 'applied' ? '편집을 적용하고 AI에 결과를 전달했습니다.' : '제안을 적용하지 않고 검토를 마쳤습니다.'); props.onClose(); }
    } catch {
      if (mounted.current) { setPendingReceipt(true); setError(resolution.body.outcome === 'applied' ? '편집은 적용됐지만 AI에 결과를 전달하지 못했습니다. 결과 전달만 다시 시도할 수 있습니다.' : '검토 결과를 전달하지 못했습니다. 다시 시도해 주세요.'); }
    } finally { if (mounted.current) setWorking(false); }
  }
  async function finish(outcome: 'applied' | 'rejected', ids: string[]) {
    const item = active.current;
    if (!item || !review || working || props.disabled || finishing.current) return;
    setWorking(true); setError('');
    try {
      const state = await request<Receipt>(`/ai/shares/${item.share.shareId}`, undefined, undefined, AbortSignal.timeout(5000));
      if (!mounted.current || active.current !== item || latest.current.key !== item.key || latest.current.props.disabled || state.status !== 'proposed' || state.proposalId !== review.proposalId || state.contextVersion !== item.share.contextVersion) throw new Error('편집 대상이나 공유 상태가 바뀌었습니다. 새로 요청해 주세요.');
      const resolution: Resolution = { item, body: { contextVersion: item.share.contextVersion, proposalId: review.proposalId, outcome, selectedIds: ids } };
      // Detach before the synchronous edit changes props/unmounts an effect scope.
      // The subsequent acknowledgement can never apply the edit a second time.
      active.current = null; finishing.current = resolution;
      try {
        if (outcome === 'applied') {
          if (item.input.task === 'settings') props.onApply?.(validateProposal(review.proposal).settings);
          else if (item.input.task === 'correction') props.captionTask!.onApply(item.input.request, validateCorrectionProposal(review.proposal, item.input.request), ids);
          else props.effectsTask!.onApply(item.input.request, validateEffectProposal(review.proposal, item.input.request) as EffectAIProposal, ids);
        }
      } catch (e) { finishing.current = null; active.current = item; throw e; }
      setReview(null);
      // Applying effects changes the parent scope immediately. Close that scope
      // in the same event before it can display an obsolete-target warning.
      if (outcome === 'applied' && props.effectsTask) props.onClose();
      await sendReceipt(resolution);
    } catch (e) { if (mounted.current && active.current === item && latest.current.key === item.key) { setError((e as Error).message); setWorking(false); } }
  }
  const config = share ? JSON.stringify({ mcpServers: { hypercut: share.connection } }, null, 2) : '';
  return <div className="mcp-share">
    <p className="field-hint">선택한 요청을 외부 AI가 읽고 제안을 돌려줄 수 있습니다. 공유는 최대 15분이며 이 창을 닫거나 요청을 바꾸면 해제를 요청합니다. 연결이 끊기면 앱의 마지막 상태 확인에서 90초 후 만료됩니다.</p>
    {!share && !finishing.current && !revoking.current && !pendingRevocation && <button className="button secondary" disabled={working || props.disabled || !props.instruction.trim()} onClick={() => void start()}><Link size={15} />{working ? '공유 준비 중…' : 'MCP로 이 요청 공유'}</button>}
    {pendingRevocation && <button className="button secondary" disabled={working} onClick={() => void revoke()}>공유 해제 다시 시도</button>}
    {share && !finishing.current && <><button className="button secondary" disabled={working} onClick={() => void revoke()}><Unplug size={15} />공유 해제</button><details className="ai-details"><summary>MCP 연결 설정 보기</summary><p className="field-hint">로컬 MCP 클라이언트의 서버 설정에 추가하세요. 이 설정에는 이번 공유의 접근 키가 포함됩니다. 공유할 때마다 새 설정이 발급됩니다.</p><textarea aria-label="MCP 연결 설정" readOnly rows={6} value={config} /><button className="button secondary" onClick={() => void navigator.clipboard.writeText(config).then(() => setNotice('MCP 연결 설정을 복사했습니다.'), () => setNotice('연결 설정을 직접 선택해 복사해 주세요.'))}><Copy size={15} />연결 설정 복사</button></details><p className="field-hint">ChatGPT에서 사용하려면 별도 Secure MCP Tunnel 설정과 계정 권한이 필요합니다. 이 버튼으로 계정에 자동 연결되지는 않습니다.</p></>}
    {notice && <p className="ai-notice" role="status">{notice}</p>}{error && <div className="ai-error" role="alert">{error}</div>}
    {pendingReceipt && <button className="button secondary" disabled={working} onClick={() => finishing.current && void sendReceipt(finishing.current)}>검토 결과 전달 다시 시도</button>}
    {review && active.current?.input.task === 'settings' && <div className="ai-proposal"><strong>적용할 설정을 확인해 주세요</strong><p>{(review.proposal as SettingProposal).explanation}</p><table><thead><tr><th>설정</th><th>현재</th><th>제안</th></tr></thead><tbody>{(Object.keys(labels) as (keyof Settings)[]).map(k => <tr key={k}><td>{labels[k]}</td><td>{props.settings[k]}</td><td>{(review.proposal as SettingProposal).settings[k]}</td></tr>)}</tbody></table><button className="button primary" disabled={working || props.disabled} onClick={() => void finish('applied', ['settings'])}>설정 적용</button><small>무음을 다시 분석하면 컷에 반영됩니다.</small></div>}
    {review && active.current?.input.task === 'correction' && <CorrectionReview key={review.proposalId} proposal={review.proposal as CorrectionProposal} disabled={working || props.disabled} onApply={ids => void finish('applied', ids)} />}
    {review && active.current?.input.task === 'effects' && <EffectProposalReview key={review.proposalId} proposal={review.proposal as EffectAIProposal} input={active.current.input.request} disabled={working || props.disabled} onApply={ids => void finish('applied', ids)} />}
    {review && <button className="button secondary" disabled={working} onClick={() => void finish('rejected', [])}>제안을 적용하지 않기</button>}
  </div>;
}
