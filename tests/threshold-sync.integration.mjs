import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { thresholdFixture, verifyThresholdSync } from '../scripts/helpers/threshold-performance-fixture.mjs';
import { capture } from '../server/process.mjs';
let input, directory;
before(async()=>{directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-sync-oracle-'));input=await thresholdFixture(60);});
after(async()=>{await rm(directory,{recursive:true,force:true});});
test('long sync oracle accepts six independently decoded source pairs',async()=>{
  const result=await verifyThresholdSync(input,input.source,[],directory);
  assert.equal(result.status,'PASS');assert.equal(result.pairs.length,6);assert.ok(Math.abs(result.firstToLastDrift)<1e-9);
});
for(const [name,filter] of [['200ms audio delay',['-af','adelay=200']],['missing audio markers',['-af','volume=0']],['missing video markers',['-vf','drawbox=x=0:y=0:w=iw:h=ih:color=black:t=fill']]]){
  test(`long sync oracle rejects ${name}`,async()=>{
    const output=path.join(directory,`${name}.mp4`);
    await capture('ffmpeg',['-v','error','-nostdin','-i',input.source,...filter,'-c:v',filter[0]==='-vf'?'libx264':'copy',...(filter[0]==='-vf'?['-threads:v','4','-preset','ultrafast']:[]),'-c:a','aac','-t','60','-y',output]);
    await assert.rejects(verifyThresholdSync(input,output,[],directory),name==='200ms audio delay'?/output tone error/:/No decoded markers/);
  });
}
