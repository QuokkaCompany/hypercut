import test from 'node:test';
import assert from 'node:assert/strict';
import { accentForCue, accentNeedsReview, validateVisualAccents, validateAccentRequest, validateAccentProposal } from '../shared/visual-accents.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
const media = { name: 'sample.mp4', fingerprint: 'a'.repeat(64), duration: 8 };
const cue = { id: 'a', start: 1, end: 3, text: '중요한 내용입니다.' };
const tr = { trackIndex: 1, channel: 0, language: 'ko', cues: [cue] };
const accent = () => accentForCue(cue, tr);
const input = () => ({ requestId: crypto.randomUUID(), instruction: '중요한 문장만', cues: [cue] });
test('v9 accent snapshots round trip, v1-v8 ignore future fields, future schemas rejected', () => {
 const a = accent(), p = makeProject(media, DEFAULT_SETTINGS, 1, [], undefined, tr, undefined, undefined, '', [a]);
 assert.equal(p.version,9); assert.deepEqual(validateProject(JSON.parse(JSON.stringify(p))).visualAccents,[a]);
 for(let version=1;version<=8;version++) assert.deepEqual(validateProject({...p,version,visualAccents:'ignored'}).visualAccents,[]);
 assert.throws(()=>validateProject({...p,visualAccents:undefined})); assert.throws(()=>validateProject({...p,version:10}));
});
test('changed text, timing, language, removed cues and changed translation require reconnect', () => {
 const a=accent();assert.equal(accentNeedsReview(a,tr),false);
 for(const patch of [{text:'다른 내용'}, {start:1.1}, {end:2.9}]) assert.equal(accentNeedsReview(a,{...tr,cues:[{...cue,...patch}]}),true);
 assert.equal(accentNeedsReview(a,{...tr,cues:[]}),true);
 const translated={...tr,outputLanguage:'en',cues:[{...cue,translations:{en:{text:'Important.',sourceText:cue.text}}}]};
 const b=accentForCue(translated.cues[0],translated);assert.equal(accentNeedsReview(b,translated),false);
 assert.equal(accentNeedsReview(b,{...translated,cues:[{...translated.cues[0],translations:{en:{text:'Changed.',sourceText:cue.text}}}]}),true);
 assert.equal(accentNeedsReview(a,translated),true);
});
test('malformed and overlapping accents rejected without discarding stale saved edits', () => {
 const a=accent();
 for(const patch of [{zoomScale:1.16},{focusX:NaN},{focusY:-1},{captionEnabled:1},{end:9},{cueId:3}]) assert.throws(()=>validateVisualAccents([{...a,...patch}],8));
 assert.throws(()=>validateVisualAccents([a,a],8));assert.throws(()=>validateVisualAccents([a,{...a,id:'b',cueId:'b',start:2,end:4}],8));
 assert.equal(validateVisualAccents([{...a,text:'old snapshot'}],8)[0].text,'old snapshot');
});
test('AI request bounded to explicit batch with sanitized fields',()=>{
 const r=input(); assert.deepEqual(validateAccentRequest({...r,filename:'private.mov'}),r);
 assert.throws(()=>validateAccentRequest({...r,cues:Array(21).fill(cue)}));
 assert.throws(()=>validateAccentRequest({...r,cues:[{...cue,text:'x'.repeat(2000)},{...cue,id:'b',text:'x'.repeat(2000)},{...cue,id:'c'}]}));
});
test('AI proposal rejects invented IDs, rewriting, times, duplicates and excessive zoom',()=>{
 const r=input(), c={id:'a',reason:'핵심',captionEnabled:true,zoomEnabled:true,zoomScale:1.08};
 assert.equal(validateAccentProposal({requestId:r.requestId,changes:[c]},r).changes.length,1);
 assert.deepEqual(validateAccentProposal({requestId:r.requestId,changes:[]},r).changes,[]);
 for(const patch of [{id:'b'},{text:'rewrite'},{start:2},{zoomScale:2},{zoomEnabled:false,captionEnabled:false}]) assert.throws(()=>validateAccentProposal({requestId:r.requestId,changes:[{...c,...patch}]},r));
 assert.throws(()=>validateAccentProposal({requestId:crypto.randomUUID(),changes:[c]},r));
 assert.throws(()=>validateAccentProposal({requestId:r.requestId,changes:[c,c]},r));
});
