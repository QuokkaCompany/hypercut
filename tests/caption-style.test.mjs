import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CAPTION_STYLE, validateCaptionStyle, captionImageEvents } from '../shared/caption-style.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { captionCues } from '../server/caption-rendering.mjs';
import { fontHasCodePoint } from '../server/font-coverage.mjs';
import { readFile } from 'node:fs/promises';
const transcript={trackIndex:1,channel:0,language:'ko',model:'manual',cues:[{id:'a',start:1,end:2.3,text:'한글'},{id:'b',start:4.001,end:5,text:'두 번째'}]};

test('C04: v4 stores style and v1/v2/v3 migrate without enabling caption burn-in',()=>{
 const project=makeProject({name:'fixture.mp4',fingerprint:'a'.repeat(64),duration:6},DEFAULT_SETTINGS,1,[],undefined,transcript,{...DEFAULT_CAPTION_STYLE,enabled:true,preset:'box'});
 assert.equal(project.version,8);assert.equal(validateProject(JSON.parse(JSON.stringify(project))).captionStyle.preset,'box');
 for(const version of [1,2,3]){const migrated=validateProject({...project,version});assert.equal(migrated.captionStyle.enabled,false);assert.deepEqual(migrated.transcript,version===3?transcript:null);}
 assert.throws(()=>validateProject({...project,captionStyle:undefined}),/스타일/);
 for(const bad of [null,{...DEFAULT_CAPTION_STYLE,sizePercent:0},{...DEFAULT_CAPTION_STYLE,marginPercent:80},{...DEFAULT_CAPTION_STYLE,enabled:'true'},{...DEFAULT_CAPTION_STYLE,preset:'url(file)'}])assert.throws(()=>validateCaptionStyle(bad));
});
test('C01/C05: PNG events use absolute microseconds and hide captions in every gap',()=>{
 const events=captionImageEvents([{start:1,end:2.333333,text:'a'},{start:4.001,end:5,text:'b'}],6);
 assert.deepEqual(events.map(x=>[x.at,x.index]),[[0,-1],[1000000,0],[2333333,-1],[4001000,1],[5000000,-1],[6000000,-1]]);
 assert.equal(Math.round(events.reduce((sum,x)=>sum+x.duration,0)*1e6),6000000);
 const cues=Array.from({length:1000},(_,i)=>({start:i*.1+.0100001,end:i*.1+.0600001}));
 const long=captionImageEvents(cues,100); assert.equal(Math.round(long.reduce((sum,x)=>sum+x.duration,0)*1e6),100000000);
 assert.throws(()=>captionImageEvents([{start:2,end:1}],6));
});
test('C02/M06: range preview clips display timing without revoking full-cut review',()=>{
 const media={duration:6,audioTracks:[{index:1,channels:1}]};
 const full=[{start:0,end:2.5},{start:3.5,end:6}],range=[{start:2.1,end:2.5},{start:3.5,end:5.1}];
 const result=captionCues(transcript,media,1,full,range);assert.equal(result.length,2);assert.equal(result[0].start,0);assert.ok(Math.abs(result[0].end-.2)<1e-9);assert.ok(Math.abs(result[1].start-.901)<1e-9);
 assert.throws(()=>captionCues(transcript,media,1,[{start:0,end:1.5},{start:1.6,end:6}]),/검토/);
 assert.throws(()=>captionCues(transcript,media,2,full),/트랙/);
});
test('C06: bundled font covers Korean/Latin/literal punctuation and detects absent emoji',async()=>{
 const has=fontHasCodePoint(await readFile('assets/fonts/NotoSansKR-Regular.otf'));
 for(const char of '한글 자막 <b>{\\N} ABC 123!')assert.equal(has(char.codePointAt(0)),true,char);
 assert.equal(has('😀'.codePointAt(0)),false);
});
