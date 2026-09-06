import { buildEffectScope } from '../../shared/effect-proposal.mjs';
export function effectProposalFixture() {
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const assets = [{ id: a, fingerprint: a, name: 'private-filename-one.wav', duration: 3 }, { id: b, fingerprint: b, name: 'private-filename-two.wav', duration: 2 }];
  const clip = (id, start, assetId = a) => ({ id, assetId, start, offset: 0, duration: .5, gainDb: -12, muted: false });
  const state = { contextId: 'local-media-id:1', duration: 8, kept: [{ start: 0, end: 2 }, { start: 4, end: 8 }], effects: { assets, clips: [clip('local-a', 4), clip('local-b', 6), clip('private-outside', 7, b)] }, cues: [{ id: 'local-cue', start: 5, end: 5.6, text: '여기를 강조합니다.' }, { id: 'private-cue', start: 6, end: 7, text: '보내지 않을 자막입니다.' }] };
  const scope = buildEffectScope(state, { assetIds: [a], clipIds: ['local-a', 'local-b'], cueIds: ['local-cue'], descriptions: { [a]: '짧은 알림음', [b]: '보내지 않을 음원 설명' } });
  const input = { ...scope.context, requestId: '00000000-0000-4000-8000-000000000001', instruction: '선택한 자막을 짧게 강조해 주세요.' };
  const proposal = { requestId: input.requestId, changes: [
    { id: 'clip-1', action: 'update', before: input.clips[0], after: { ...input.clips[0], start: 5, duration: .4, gainDb: -6 }, reason: '자막 시작에 맞추고 길이 조절' },
    { id: 'clip-2', action: 'remove', before: input.clips[1], after: null, reason: '이 소리를 삭제하는 선택 제안' },
    { id: 'new-1', action: 'add', before: null, after: { id: 'new-1', assetId: 'asset-1', start: 6.5, offset: .1, duration: .25, gainDb: -12, muted: false }, reason: '짧은 전환음 추가' },
  ] };
  return { state, scope, input, proposal };
}
