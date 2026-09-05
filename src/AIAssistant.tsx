import { useEffect, useRef, useState } from 'react';
import { Check, Copy, LoaderCircle, Plug, Sparkles, Unplug, X } from 'lucide-react';
import { proposalPrompt, validateProposal } from '../shared/ai.mjs';
import { request } from './api';
import type { Settings } from './types';

type Provider = 'manual' | 'ollama' | 'openai' | 'anthropic' | 'claude_cli';
type Proposal = { settings: Settings; explanation: string };
type CLIStatus = { installed: boolean; compatible: boolean; loggedIn: boolean; ready: boolean; version?: string; error?: string };
type Execution = { models: string[]; inputTokens: number | null; outputTokens: number | null };
const labels: Record<keyof Settings, string> = { thresholdDb: '음량 기준 (dBFS)', minSilenceMs: '최소 무음 (ms)', preRollMs: '말하기 전 (ms)', postRollMs: '말하기 후 (ms)' };

export function AIAssistant({ settings, contextId, disabled, onApply, onClose }: { settings: Settings; contextId: string; disabled: boolean; onApply: (settings: Settings) => void; onClose: () => void }) {
  const [provider, setProvider] = useState<Provider>('manual'), [model, setModel] = useState(''), [apiKey, setApiKey] = useState(''), [baseURL, setBaseURL] = useState('http://127.0.0.1:11434');
  const [connected, setConnected] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [instruction, setInstruction] = useState('작은 목소리와 짧은 쉼은 살리고, 긴 무음만 줄이고 싶어요.');
  const [response, setResponse] = useState(''), [prompt, setPrompt] = useState(''), [proposal, setProposal] = useState<Proposal | null>(null);
  const [cliStatus, setCLIStatus] = useState<CLIStatus | null>(null), [checkingCLI, setCheckingCLI] = useState(false), [verified, setVerified] = useState(false), [execution, setExecution] = useState<Execution | null>(null);
  const revision = useRef(0), statusRevision = useRef(0), mounted = useRef(true);
  const context = JSON.stringify([contextId, settings]);
  const previousContext = useRef(context);
  useEffect(() => {
    mounted.current = true;
    const current = revision.current;
    void request<{ connected: boolean; provider?: Provider; model?: string; baseURL?: string; verified?: boolean; lastExecution?: Execution }>('/ai/connection').then(value => {
      if (!mounted.current || revision.current !== current) return;
      if (value.connected) { setProvider(value.provider!); setModel(value.model!); setBaseURL(value.baseURL || 'http://127.0.0.1:11434'); setConnected(true); setVerified(value.verified === true); setExecution(value.lastExecution || null); }
    }).catch(() => {});
    return () => { mounted.current = false; revision.current++; statusRevision.current++; void request('/ai/proposal', undefined, 'DELETE').catch(() => {}); };
  }, []);
  async function checkCLI() {
    setCheckingCLI(true); const current = ++statusRevision.current;
    try { const status = await request<CLIStatus>('/ai/claude/status'); if (mounted.current && statusRevision.current === current) setCLIStatus(status); }
    catch (e) { if (mounted.current && statusRevision.current === current) setError((e as Error).message); }
    finally { if (mounted.current && statusRevision.current === current) setCheckingCLI(false); }
  }
  useEffect(() => { if (provider === 'claude_cli') void checkCLI(); }, [provider]);
  useEffect(() => { if (previousContext.current !== context) { previousContext.current = context; revision.current++; setProposal(null); setPrompt(''); setWorking(false); void request('/ai/proposal', undefined, 'DELETE').catch(() => {}); } }, [context]);
  function clearProposal() { revision.current++; setProposal(null); setError(''); setNotice(''); }
  async function changeProvider(next: Provider) {
    clearProposal(); statusRevision.current++; setProvider(next); setModel(next === 'claude_cli' ? 'sonnet' : ''); setApiKey(''); setConnected(false); setWorking(false); setVerified(false); setExecution(null); setCLIStatus(null); setCheckingCLI(false);
    await request('/ai/connection', undefined, 'DELETE').catch(e => setError(e.message));
  }
  async function connect() {
    setError(''); setWorking(true); const current = ++revision.current;
    try {
      await request('/ai/connection', { provider, model, apiKey, baseURL });
      if (mounted.current && current === revision.current) { setConnected(true); setApiKey(''); setNotice('연결 설정을 저장했습니다. 실제 연결은 제안 요청 시 확인됩니다.'); }
    } catch (e) { if (mounted.current && current === revision.current) setError((e as Error).message); }
    finally { if (mounted.current && current === revision.current) setWorking(false); }
  }
  async function ask() {
    setError(''); setNotice(''); setProposal(null); setWorking(true); setVerified(false); setExecution(null); const current = ++revision.current;
    try {
      const result = await request<Proposal>('/ai/proposal', { instruction, settings });
      if (mounted.current && current === revision.current) {
        setProposal(validateProposal(result)); setVerified(true);
        const state = await request<{ lastExecution?: Execution }>('/ai/connection').catch(() => null);
        if (mounted.current && current === revision.current) setExecution(state?.lastExecution || null);
      }
    } catch (e) { if (mounted.current && current === revision.current) setError((e as Error).message); }
    finally { if (mounted.current && current === revision.current) setWorking(false); }
  }
  async function copyPrompt() {
    try {
      const text = proposalPrompt(instruction, settings); setPrompt(text); setError('');
      await navigator.clipboard.writeText(text); setNotice('요청을 복사했습니다. 사용하는 AI 채팅에 붙여넣어 주세요.');
    } catch { setNotice('아래 요청을 직접 선택해 복사할 수 있습니다.'); }
  }
  const cloud = provider === 'openai' || provider === 'anthropic';
  return <div className="modal-backdrop"><section className="modal ai-modal" role="dialog" aria-modal="true" aria-label="AI 편집 도우미">
    <div className="panel-heading"><h2><Sparkles size={19} /> AI 편집 도우미</h2><button className="icon-button" aria-label="AI 창 닫기" onClick={onClose}><X size={18} /></button></div>
    <p className="ai-intro">원하는 편집을 말하면 무음 설정을 제안받을 수 있어요.</p>
    <label className="ai-field">사용할 AI<select value={provider} onChange={e => void changeProvider(e.target.value as Provider)} disabled={working}><option value="manual">ChatGPT · Claude 채팅 — 복사해서 사용</option><option value="claude_cli">Claude Code — 기존 구독 로그인</option><option value="ollama">Ollama — 로컬 모델</option><option value="openai">OpenAI API — 별도 API 키</option><option value="anthropic">Claude API — 별도 API 키</option></select></label>
    {provider !== 'manual' && <div className="ai-connection">
      {provider === 'claude_cli' && <div className="cli-status"><p>{checkingCLI ? 'Claude Code 설치와 로그인 상태 확인 중…' : cliStatus?.ready ? `Claude Code ${cliStatus.version} · 구독 로그인 확인됨` : cliStatus?.error || '설치와 로그인 상태를 확인해 주세요.'}</p><button className="text-button" disabled={checkingCLI || working} onClick={() => void checkCLI()}>상태 다시 확인</button>{cliStatus && !cliStatus.ready && <p>터미널에서 <code>claude auth login</code>으로 로그인한 뒤 다시 확인하세요. 로그인 상태 확인에는 모델 요청을 보내지 않습니다.</p>}</div>}
      <label className="ai-field">모델 이름<input value={model} placeholder={provider === 'ollama' ? '설치한 로컬 모델 이름' : '계정에서 사용할 수 있는 모델 ID'} disabled={connected || working} onChange={e => setModel(e.target.value)} /></label>
      {provider === 'ollama' ? <label className="ai-field">Ollama 주소<input value={baseURL} disabled={connected || working} onChange={e => setBaseURL(e.target.value)} /></label> : cloud && <label className="ai-field">API 키<input type="password" autoComplete="off" value={apiKey} placeholder={connected ? '이번 앱 실행 중에만 보관됨' : '키는 프로젝트 파일에 저장하지 않아요'} disabled={connected || working} onChange={e => setApiKey(e.target.value)} /></label>}
      <button className="button secondary" disabled={working || (!connected && (!model || (cloud && !apiKey)))} onClick={() => connected ? void changeProvider(provider) : void connect()}>{connected ? <Unplug size={14} /> : <Plug size={14} />}{connected ? '연결 해제' : '연결 설정 저장'}</button>
      {connected && <p className="ai-notice">{verified ? 'AI 응답을 확인했습니다.' : '설정 저장됨 · 실제 응답은 아직 확인하지 않았습니다.'}</p>}
    </div>}
    <div className="modal-note">{cloud ? 'API 사용료는 ChatGPT·Claude 채팅 구독과 별도일 수 있어요. 아래 요청과 네 가지 설정만 선택한 공급자에게 보냅니다.' : provider === 'claude_cli' ? '설치된 Claude Code의 기존 구독 로그인으로 요청합니다. 제안 요청 시 해당 계정의 사용량이 적용됩니다. 파일·셸·외부 도구는 사용할 수 없고, 요청 문장과 네 가지 설정으로만 제안합니다.' : provider === 'ollama' ? '이 컴퓨터에서 실행하는 Ollama 모델을 사용합니다. 서버가 꺼져 있어도 무음 편집은 계속할 수 있어요.' : '사용 중인 ChatGPT·Claude 채팅에 요청을 붙여넣고, 받은 JSON 응답을 가져오세요. 자동 로그인 연결은 아닙니다.'} 영상·음성·파일 이름은 보내지 않습니다.</div>
    <label className="ai-field">어떻게 편집할까요?<textarea value={instruction} maxLength={2000} rows={3} disabled={working} onChange={e => { setInstruction(e.target.value); clearProposal(); setPrompt(''); }} /></label>
    {provider === 'manual' ? <>
      <button className="button secondary" disabled={!instruction.trim()} onClick={() => void copyPrompt()}><Copy size={15} />AI에게 보낼 요청 복사</button>
      {prompt && <details className="ai-details"><summary>보낼 요청 보기</summary><textarea aria-label="복사용 AI 요청" readOnly value={prompt} rows={5} /></details>}
      <label className="ai-field">AI 응답 가져오기<textarea value={response} aria-label="AI JSON 응답" rows={3} placeholder='{"settings": {...}, "explanation": "..."}' onChange={e => { setResponse(e.target.value); clearProposal(); }} /></label>
      <button className="button secondary" disabled={!response.trim()} onClick={() => { try { setProposal(validateProposal(response)); setError(''); } catch (e) { setError((e as Error).message); } }}><Check size={15} />응답 확인</button>
    </> : <button className="button primary" disabled={!connected || !instruction.trim() || (!working && provider === 'claude_cli' && !cliStatus?.ready)} onClick={() => working ? void request('/ai/proposal', undefined, 'DELETE').catch(e => setError(e.message)) : void ask()}>{working ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />}{working ? '요청 취소' : cloud ? '제안 요청 · API 사용' : provider === 'claude_cli' ? '제안 요청 · Claude 구독 사용' : '로컬 AI에 제안 요청'}</button>}
    {execution && <p className="ai-notice">실행 모델: {execution.models.join(', ') || model} · 입력 {execution.inputTokens ?? '확인 불가'} / 출력 {execution.outputTokens ?? '확인 불가'} 토큰</p>}
    {error && <div className="ai-error" role="alert">{error}</div>}{notice && <p className="ai-notice" role="status">{notice}</p>}
    {proposal && <div className="ai-proposal"><strong>적용할 설정을 확인해 주세요</strong><p>{proposal.explanation}</p><table><thead><tr><th>설정</th><th>현재</th><th>제안</th></tr></thead><tbody>{(Object.keys(labels) as (keyof Settings)[]).map(key => <tr key={key}><td>{labels[key]}</td><td>{settings[key]}</td><td>{proposal.settings[key]}</td></tr>)}</tbody></table><button className="button primary" disabled={disabled || working} onClick={() => { onApply(proposal.settings); onClose(); }}><Check size={15} />설정 적용</button><small>적용 후 무음을 다시 분석하면 컷에 반영됩니다.</small></div>}
  </section></div>;
}
