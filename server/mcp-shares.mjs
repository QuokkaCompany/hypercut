import { TRANSLATION_SCHEMA, translationPrompt, validateTranslationRequest, validateTranslationProposal } from '../shared/caption-translation.mjs';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { PROPOSAL_SCHEMA, proposalPrompt, validateProposal } from '../shared/ai.mjs';
import { CORRECTION_SCHEMA, correctionPrompt, validateCorrectionRequest, validateCorrectionProposal } from '../shared/caption-correction.mjs';
import { EFFECT_PROPOSAL_SCHEMA, effectPrompt, validateEffectRequest, validateEffectProposal } from '../shared/effect-proposal.mjs';
import { validateSettings } from '../shared/timeline.mjs';

export const SHARE_LIMITS = Object.freeze({ shares: 8, bytes: 128 * 1024, lifetimeMs: 15 * 60 * 1000, leaseMs: 90 * 1000 });
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const hash = value => createHash('sha256').update(value).digest();
const canonical = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
function fail(message, code = 'INVALID_SHARE_REQUEST', status = 400) { throw Object.assign(new Error(message), { code, status }); }
function bounded(value) {
  let text;
  try { text = JSON.stringify(value); } catch { fail('공유 요청은 JSON이어야 합니다.'); }
  if (!text || Buffer.byteLength(text) > SHARE_LIMITS.bytes) fail('공유 요청은 128 KiB 이하여야 합니다.', 'SHARE_TOO_LARGE', 413);
  return JSON.parse(text);
}
function prepare(input) {
  const value = bounded(input);
  if (!exact(value, ['task', 'request'])) fail('공유할 작업과 범위를 확인해 주세요.');
  const { task } = value;
  if (task === 'settings') {
    const { instruction, settings } = value.request || {};
    const prompt = proposalPrompt(instruction, settings);
    return { task, request: { instruction, settings: validateSettings(settings) }, prompt, schema: PROPOSAL_SCHEMA };
  }
  if (task === 'translation') {
    const request = validateTranslationRequest(value.request);
    return { task, request, prompt: translationPrompt(request), schema: TRANSLATION_SCHEMA };
  }
  if (task === 'correction') {
    const request = validateCorrectionRequest(value.request);
    return { task, request, prompt: correctionPrompt(request), schema: CORRECTION_SCHEMA };
  }
  if (task === 'effects') {
    const request = validateEffectRequest(value.request);
    return { task, request, prompt: effectPrompt(request), schema: EFFECT_PROPOSAL_SCHEMA };
  }
  fail('지원하지 않는 공유 작업입니다.');
}
const validate = (share, proposal) => share.task === 'settings' ? validateProposal(proposal) : share.task === 'translation' ? validateTranslationProposal(proposal, share.request) : share.task === 'correction' ? validateCorrectionProposal(proposal, share.request) : validateEffectProposal(proposal, share.request);

// App-authenticated callers own the lifecycle. The separate capability can only
// read this immutable snapshot and queue one proposal; it cannot apply edits.
export function createShareStore({ now = Date.now } = {}) {
  const shares = new Map(); let closed = false;
  function sweep() { for (const [id, s] of shares) if (now() >= s.expiresAt || now() >= s.leaseExpiresAt) shares.delete(id); }
  function get(id) {
    sweep(); const s = uuid(id) && !closed && shares.get(id);
    if (!s) fail('공유가 만료되었거나 해제되었습니다. 앱에서 다시 공유해 주세요.', 'SHARE_UNAVAILABLE', 404);
    return s;
  }
  function authorized(id, capability) {
    const s = get(id);
    if (typeof capability !== 'string' || !/^[0-9a-f]{64}$/.test(capability) || !timingSafeEqual(hash(capability), s.capabilityHash)) fail('이 공유에 접근할 권한이 없습니다.', 'SHARE_UNAUTHORIZED', 401);
    return s;
  }
  const receipt = s => ({ shareId: s.shareId, contextVersion: s.contextVersion, task: s.task, status: s.status, expiresAt: s.expiresAt, leaseExpiresAt: s.leaseExpiresAt, proposalId: s.proposalId, resolution: s.resolution ? structuredClone(s.resolution) : null });
  return {
    create(input) {
      if (closed) fail('앱 연결이 종료되었습니다.', 'SHARE_UNAVAILABLE', 404);
      sweep();
      if (shares.size >= SHARE_LIMITS.shares) fail('동시 공유는 8개까지 가능합니다. 기존 공유를 해제해 주세요.', 'SHARE_LIMIT', 409);
      const data = prepare(input), capability = randomBytes(32).toString('hex'), created = now();
      const s = { ...data, shareId: randomUUID(), contextVersion: randomUUID(), capabilityHash: hash(capability), expiresAt: created + SHARE_LIMITS.lifetimeMs, leaseExpiresAt: created + SHARE_LIMITS.leaseMs, status: 'waiting', proposalId: null, proposal: null, proposalHash: null, resolution: null };
      shares.set(s.shareId, s);
      return { ...receipt(s), capability };
    },
    ownerRead(id) {
      const s = get(id);
      // Only the app can renew its lease. Model polling cannot keep a closed tab alive.
      s.leaseExpiresAt = Math.min(s.expiresAt, now() + SHARE_LIMITS.leaseMs);
      return { ...receipt(s), proposal: structuredClone(s.proposal) };
    },
    read(id, capability) {
      const s = authorized(id, capability);
      return { ...receipt(s), context: s.request ? structuredClone({ request: s.request, instructions: s.prompt, proposalSchema: s.schema }) : null };
    },
    submit(id, capability, input) {
      const s = authorized(id, capability), value = bounded(input);
      if (!exact(value, ['contextVersion', 'proposalId', 'proposal']) || value.contextVersion !== s.contextVersion || !uuid(value.proposalId) || !value.proposal || typeof value.proposal !== 'object' || Array.isArray(value.proposal)) fail('현재 공유의 문맥 버전과 제안 ID를 확인해 주세요.', 'STALE_SHARE', 409);
      if (s.proposalId) {
        if (s.proposalId !== value.proposalId || !timingSafeEqual(hash(canonical(value.proposal)), s.proposalHash)) fail('이미 받은 제안과 다른 요청입니다. 앱에서 새로 공유해 주세요.', 'PROPOSAL_CONFLICT', 409);
        return receipt(s);
      }
      const proposal = validate(s, value.proposal);
      s.proposal = structuredClone(proposal); s.proposalId = value.proposalId;
      s.proposalHash = hash(canonical(proposal)); s.status = 'proposed';
      return receipt(s);
    },
    resolve(id, input) {
      const s = get(id), value = bounded(input);
      if (!exact(value, ['contextVersion', 'proposalId', 'outcome', 'selectedIds']) || value.contextVersion !== s.contextVersion || !s.proposalId || value.proposalId !== s.proposalId || !['applied', 'rejected'].includes(value.outcome) || !Array.isArray(value.selectedIds)) fail('검토한 제안과 적용 결과를 확인해 주세요.');
      const resolution = { outcome: value.outcome, selectedIds: value.selectedIds };
      if (s.resolution) {
        if (canonical(resolution) !== canonical(s.resolution)) fail('이미 기록한 적용 결과는 바꿀 수 없습니다.', 'PROPOSAL_CONFLICT', 409);
        return receipt(s);
      }
      const allowed = s.task === 'settings' ? ['settings'] : s.proposal.changes.map(change => change.id);
      if (new Set(value.selectedIds).size !== value.selectedIds.length || value.selectedIds.some(id => !allowed.includes(id)) || (value.outcome === 'applied' ? !value.selectedIds.length : value.selectedIds.length)) fail('실제로 적용한 항목만 선택해 주세요.');
      s.resolution = structuredClone(resolution); s.status = value.outcome;
      // Retain only a bounded receipt for model acknowledgement/retries.
      s.request = null; s.prompt = null; s.schema = null; s.proposal = null;
      return receipt(s);
    },
    revoke(id) { shares.delete(id); return { revoked: true }; },
    sweep,
    close() { closed = true; shares.clear(); },
  };
}
