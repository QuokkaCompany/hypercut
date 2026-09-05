import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { applyCaptionCorrection, correctionPrompt, correctionWarnings, validateCorrectionProposal, validateCorrectionRequest } from '../shared/caption-correction.mjs';
import { askCaptionCorrection } from '../server/ai.mjs';
const input = { requestId: randomUUID(), instruction: '오타와 띄어쓰기만 교정', glossary: '캡컶 → 캡컷', cues: [{ id: 'a', text: '캡컶에서 10분을 편집햇어요.' }, { id: 'b', text: '소리를 없애지 않습니다.' }] };
const proposal = { requestId: input.requestId, changes: [{ id: 'a', before: input.cues[0].text, after: '캡컷에서 10분을 편집했어요.', reason: '앱 이름과 맞춤법 수정' }, { id: 'b', before: input.cues[1].text, after: '소리를 없앱니다.', reason: '의미가 달라지는 모의 응답' }] };
test('C07/C08: prompts contain only selected text, request ID and explicit instruction/glossary', () => {
  const prompt = correctionPrompt({ ...input, mediaPath: '/private/user.mp4', apiKey: 'private-key', cues: input.cues.map(cue => ({ ...cue, start: 99, end: 100 })) });
  assert.ok(prompt.includes('캡컶')); assert.ok(!prompt.includes('/private')); assert.ok(!prompt.includes('private-key')); assert.ok(!prompt.includes('"start"')); assert.ok(!prompt.includes('"end"'));
  assert.throws(() => validateCorrectionRequest({ ...input, cues: Array.from({ length: 21 }, (_, i) => ({ id: String(i), text: '한글' })) }));
  assert.throws(() => validateCorrectionRequest({ ...input, cues: [0,1,2].map(i => ({ id: String(i), text: '가'.repeat(2000) })) }), /4,000/);
});
test('C07: proposal rejects wrong request, unknown/duplicate IDs, changed numbers and timing payloads', () => {
  assert.deepEqual(validateCorrectionProposal(JSON.stringify(proposal), input), proposal);
  assert.deepEqual(validateCorrectionProposal({ requestId: input.requestId, changes: [] }, input).changes, []);
  const one = change => ({ requestId: input.requestId, changes: [change] });
  for (const invalid of [{ ...proposal, requestId: randomUUID() }, { ...proposal, changes: [proposal.changes[0], proposal.changes[0]] }, one({ ...proposal.changes[0], id: 'unknown' }), one({ ...proposal.changes[0], before: 'different text' }), one({ ...proposal.changes[0], after: '' }), one({ ...proposal.changes[0], after: '캡컷에서 100분을 편집했어요.' }), one({ ...proposal.changes[0], start: 3 }), { ...proposal, command: 'execute' }]) assert.throws(() => validateCorrectionProposal(invalid, input));
});
test('C07: explicit selection applies once, preserves times and rejects changed snapshots', () => {
  const transcript = { trackIndex: 1, channel: 0, language: 'ko', model: 'manual', cues: input.cues.map((cue,i) => ({ ...cue, start: i*3, end: i*3+2, reviewedFor: 'old-review' })) };
  const next = applyCaptionCorrection(transcript, input, proposal, ['a']);
  assert.equal(next.cues[0].text, proposal.changes[0].after); assert.equal(next.cues[0].reviewedFor, undefined); assert.deepEqual(next.cues[1], transcript.cues[1]); assert.deepEqual(next.cues.map(({ start,end }) => ({ start,end })), [{start:0,end:2},{start:3,end:5}]);
  assert.equal(transcript.cues[0].text, input.cues[0].text);
  assert.throws(() => applyCaptionCorrection(next, input, proposal, ['a']), /변경/);
  assert.throws(() => applyCaptionCorrection({ ...transcript, cues: [transcript.cues[0]] }, input, proposal, ['a']), /변경/);
  assert.throws(() => applyCaptionCorrection(transcript, input, proposal, []), /선택/);
  assert.ok(correctionWarnings(proposal.changes[1].before, proposal.changes[1].after).length);
  assert.equal(correctionWarnings(proposal.changes[0].before, proposal.changes[0].after).length, 0);
});
for (const provider of ['ollama','openai','anthropic']) test(`C08: ${provider} correction contract uses only selected model and text (mock)`, async () => {
  let calls=0;
  const result=await askCaptionCorrection({ provider, model:'selected-model', apiKey:'test-secret' }, input, { fetchImpl: async (url, options) => {
    calls++;const body=JSON.parse(options.body);assert.equal(body.model,'selected-model');assert.equal(options.redirect,'error');assert.ok(options.body.includes(input.requestId));assert.ok(!options.body.includes('test-secret'));assert.equal(body.tools,undefined);
    const schema=provider==='ollama'?body.format:provider==='openai'?body.text.format.schema:body.output_config.format.schema;
    assert.deepEqual(schema.required,['requestId','changes']);assert.equal(schema.additionalProperties,false);
    if(provider==='ollama'){assert.equal(url,'http://127.0.0.1:11434/api/chat');return Response.json({done:true,message:{content:JSON.stringify(proposal)}});}
    if(provider==='openai'){assert.equal(body.store,false);assert.equal(body.max_output_tokens,16384);return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(proposal)}]}]});}
    return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(proposal)}]});
  } });assert.deepEqual(result,proposal);assert.equal(calls,1);
});
test('C08: invalid request makes no provider call and a failed correction never falls back',async()=>{
 let calls=0;const fetchImpl=async()=>{calls++;return new Response('private-provider-body',{status:429});};
 await assert.rejects(askCaptionCorrection({provider:'openai',model:'model',apiKey:'test'}, {...input,cues:[]}, {fetchImpl}));assert.equal(calls,0);
 await assert.rejects(askCaptionCorrection({provider:'openai',model:'model',apiKey:'test'}, input, {fetchImpl}), /한도/);assert.equal(calls,1);
});
