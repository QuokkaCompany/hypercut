import { mkdir, readFile, writeFile, stat, copyFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { capture } from '../../server/process.mjs';
import { inspectMedia, publicMedia } from '../../server/media.mjs';
import { sha256 } from './transcription-performance-fixture.mjs';

export async function thresholdFixture(seconds) {
  const directory = path.resolve('test-output/threshold-performance-fixtures');
  await mkdir(directory, { recursive: true });
  const source = path.join(directory, `${seconds}s.mp4`), manifest = path.join(directory, `${seconds}s.json`);
  const previous = await readFile(manifest, 'utf8').then(JSON.parse).catch(() => null);
  if (previous && await stat(source).catch(() => null) && await sha256(source) === previous.media.fingerprint) return { ...previous, source };
  const baseline = await readFile('test-output/benchmark/results.json', 'utf8').then(JSON.parse).catch(() => null);
  const known = baseline?.runs.find(run => run.inputSeconds === seconds), existing = path.resolve(`test-output/benchmark/${seconds}s.mp4`);
  let reusedBaseline = false;
  if (known && await stat(existing).catch(() => null) && await sha256(existing) === known.fingerprint) {
    await copyFile(existing, source); reusedBaseline = true;
  } else {
    const cycle = path.join(directory, 'cycle.mp4');
    await capture('ffmpeg', ['-v','error','-nostdin','-f','lavfi','-i',"color=c=0x243023:s=1920x1080:r=30:d=3.6,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,0.4,0.6)'",'-an','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-y',cycle]);
    await capture('ffmpeg', ['-v','error','-nostdin','-stream_loop','-1','-i',cycle,'-f','lavfi','-i',"aevalsrc='0.15*sin(2*PI*440*t)*lt(mod(t,3.6),2.6)':s=48000",'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','128k','-t',String(seconds),'-movflags','+faststart','-y',source]);
  }
  const media = publicMedia(await inspectMedia(source));
  assert.ok(Math.abs(media.duration-seconds)<1/30); assert.equal(media.width,1920); assert.equal(media.height,1080); assert.equal(media.fps,30); assert.equal(media.audioTracks[0].sampleRate,48000);
  const result = { kind:'Repeated synthetic 440Hz tone and 400ms-delayed flash; not human speech', cycleSeconds:3.6, toneSeconds:2.6, flashSeconds:.4, expectedCuts:Math.floor(seconds/3.6), reusedBaseline, media };
  await writeFile(manifest,JSON.stringify(result,null,2)+'\n'); return {...result,source};
}

async function markers(file, seek, seconds, pcmFile) {
  const metadata = await capture('ffmpeg', ['-v','error','-nostdin','-ss',String(seek),'-i',file,'-t',String(seconds),'-vf','scale=16:16,signalstats,metadata=print:file=-','-an','-f','null','-']);
  let time=0, active=false; const flashes=[];
  for(const line of metadata.split('\n')) {
    const match=line.match(/pts_time:([\d.]+)/);if(match)time=Number(match[1]);
    if(line.startsWith('lavfi.signalstats.YAVG=')){const white=Number(line.split('=')[1])>200;if(white&&!active)flashes.push(seek+time);active=white;}
  }
  await capture('ffmpeg',['-v','error','-nostdin','-ss',String(seek),'-i',file,'-t',String(seconds),'-map','0:a:0','-f','f32le','-ac','1','-ar','48000','-y',pcmFile]);
  const pcm=await readFile(pcmFile), tones=[];let loud=false,last=-10000;
  for(let i=0;i<pcm.length/4;i++){
    if(Math.abs(pcm.readFloatLE(i*4))>.07){if(!loud)tones.push(seek+i/48000);loud=true;last=i;}
    else if(i-last>2400)loud=false;
  }
  return {seek,seconds,flashes,tones};
}

export async function verifyThresholdSync(input, outputFile, cuts, directory) {
  // Independent arithmetic over actual cut intervals; no product time-mapping helper.
  const map = time => time-cuts.filter(cut=>cut.enabled&&cut.end<=time).reduce((sum,cut)=>sum+cut.end-cut.start,0);
  const groups=[['start',1],['middle',Math.floor(input.media.duration/3.6/2)],['end',Math.floor(input.media.duration/3.6)-2]], windows=[], pairs=[];
  const tolerance=1/30;
  for(const [name,cycle] of groups){
    const at=cycle*3.6, sourceSeek=at-.3, outputSeek=Math.floor((map(at)-.3)*30)/30;
    const source=await markers(input.source,sourceSeek,7.2,path.join(directory,'source-window.f32'));
    const output=await markers(outputFile,outputSeek,7.2,path.join(directory,'output-window.f32'));
    for(const index of [cycle,cycle+1]){
      const expectedTone=index*3.6,expectedFlash=expectedTone+.4;
      const nearest=(values,target)=>{assert.ok(values.length>0,'No decoded markers');return values.reduce((a,b)=>Math.abs(a-target)<Math.abs(b-target)?a:b);};
      const sourceTone=nearest(source.tones,expectedTone),sourceFlash=nearest(source.flashes,expectedFlash);
      assert.ok(Math.abs(sourceTone-expectedTone)<=tolerance,`${name} source tone`);assert.ok(Math.abs(sourceFlash-expectedFlash)<=tolerance,`${name} source flash`);
      const expectedOutputTone=map(sourceTone),expectedOutputFlash=map(sourceFlash),outputTone=nearest(output.tones,expectedOutputTone),outputFlash=nearest(output.flashes,expectedOutputFlash);
      const toneError=outputTone-expectedOutputTone,flashError=outputFlash-expectedOutputFlash,extraAVError=(outputFlash-outputTone)-(sourceFlash-sourceTone);
      assert.ok(Math.abs(toneError)<=tolerance,`${name} output tone error ${toneError}`);assert.ok(Math.abs(flashError)<=tolerance,`${name} output flash error ${flashError}`);assert.ok(Math.abs(extraAVError)<=tolerance,`${name} extra A/V error ${extraAVError}`);
      pairs.push({name,cycle:index,precedingCuts:cuts.filter(cut=>cut.enabled&&cut.end<=expectedTone).length,sourceTone,sourceFlash,expectedOutputTone,expectedOutputFlash,outputTone,outputFlash,toneError,flashError,extraAVError});
    }
    windows.push({name,source,output});
  }
  const firstToLastDrift=pairs.at(-1).extraAVError-pairs[0].extraAVError;assert.ok(Math.abs(firstToLastDrift)<=tolerance);
  return {status:'PASS',scope:'Six independently decoded flash/tone pairs in start/middle/end windows; not exhaustive frame identity or human listening.',toleranceSeconds:tolerance,firstToLastDrift,pairs,windows};
}
