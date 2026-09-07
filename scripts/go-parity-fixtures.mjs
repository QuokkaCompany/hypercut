// Regenerate deterministic contract fixtures from the browser/shared reference.
import { writeFile, mkdir } from 'node:fs/promises';
import { DEFAULT_SETTINGS, createCuts, renderPlan, restoreRange } from '../shared/timeline.mjs';
import { mapCaptions } from '../shared/captions.mjs';
const cases=[];
for (const fps of [24, 30, 30000/1001]) for (let i=0;i<12;i++) {
 const duration=10, frames=Array.from({length:Math.ceil(duration*fps)},(_,n)=>n/fps); frames.push(duration);
 const candidates=[{start:0,end:.9+i*.001},{start:2+i*.03,end:4+i*.02},{start:7.7,end:10}];
 const cuts=createCuts(candidates,DEFAULT_SETTINGS,duration,frames);
 const range={start:1.01+i*.005,end:8.99-i*.03},plan=renderPlan(cuts,duration,frames,range);
 const transcript={trackIndex:1,channel:0,language:'en',cues:[{id:'part',start:1.9,end:4.1,text:'3 <clips> & captions'},{id:'gone',start:.01,end:.1,text:'removed'},{id:'unicode',start:5,end:7,text:'字幕\u2028line\u2029break'}]};
 cases.push({duration,frames,candidates,settings:DEFAULT_SETTINGS,cuts,range,plan,restored:restoreRange(cuts,2.9,3.1,duration,frames),transcript,mapped:mapCaptions(transcript,plan.kept)});
}
await mkdir('internal/media/testdata',{recursive:true});
await writeFile('internal/media/testdata/browser-contract.json',JSON.stringify(cases));
console.log(`${cases.length} deterministic timeline/caption contracts generated.`);
