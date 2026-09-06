import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp,rm,readFile,writeFile,readdir,copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { capture,startProcess } from '../server/process.mjs';
import { inspectMedia,exportMedia } from '../server/media.mjs';
import { renderCaptionImages } from '../server/caption-rendering.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-caption-render-'));
const fixture=path.join(directory,'source.mp4'),cuts=[{id:'cut',start:2.5,end:3.5,enabled:true}];
const transcript={trackIndex:1,channel:0,language:'ko',model:'manual',cues:[{id:'a',start:1,end:2.3,text:'한글 자막 <b>{\\N}'},{id:'b',start:4.001,end:5,text:'두 번째 자막'}]};
const reports=[];
await capture('ffmpeg',['-v','error','-f','lavfi','-i','color=c=0x334455:s=640x360:r=30:d=6','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=6','-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac','-y',fixture]);
const media=await inspectMedia(fixture),sourceHash=createHash('sha256').update(await readFile(fixture)).digest('hex');
reports.push({kind:'fixture',sourceSHA256:sourceHash,width:640,height:360,duration:6,fps:30,originalCuts:cuts,originalCues:transcript.cues,ffmpeg:(await capture('ffmpeg',['-version'])).split('\n')[0],fonts:JSON.parse(await readFile('assets/fonts/manifest.json','utf8'))});
async function pixelEvidence(file,expected,{yellow=false}={}){
 const info=JSON.parse(await capture('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file])),stream=info.streams.find(x=>x.codec_type==='video');
 const times=(await capture('ffprobe',['-v','error','-select_streams','v','-show_entries','frame=pts_time','-of','csv=p=0',file])).split('\n').map(x=>x.replace(/,$/,'' )).filter(Boolean).map(Number);
 const stride=stream.width*stream.height*3,frame=Buffer.alloc(stride),task=startProcess('ffmpeg',['-v','error','-i',file,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','-']);
 let used=0,index=0;const active=[],bounds=[];
 for await(const chunk of task.child.stdout){let offset=0;while(offset<chunk.length){const n=Math.min(stride-used,chunk.length-offset);chunk.copy(frame,used,offset,offset+n);used+=n;offset+=n;if(used!==stride)continue;
  let count=0,left=stream.width,right=0,top=stream.height,bottom=0;
  for(let pixel=0;pixel<stream.width*stream.height;pixel++){const i=pixel*3;const match=yellow?frame[i]>155&&frame[i+1]>125&&frame[i+2]<130:frame[i]>170&&frame[i+1]>170&&frame[i+2]>170;if(match){count++;const x=pixel%stream.width,y=Math.floor(pixel/stream.width);left=Math.min(left,x);right=Math.max(right,x);top=Math.min(top,y);bottom=Math.max(bottom,y);}}
  const visible=count>30,should=expected.some(([start,end])=>times[index]>=start-1e-7&&times[index]<end-1e-7);assert.equal(visible,should,`caption at frame ${index}, PTS ${times[index]}, pixels ${count}`);
  if(visible){active.push(index);bounds.push({left,right,top,bottom});}index++;used=0;
 }}await task.done;assert.equal(used,0);assert.equal(index,times.length);assert.ok(active.length>0);
 assert.ok(bounds.every(box=>box.left>=stream.width*.04&&box.right<=stream.width*.96&&box.top>=stream.height*.04&&box.bottom<=stream.height*.96));
 return {width:stream.width,height:stream.height,frames:index,firstCaptionFrame:active[0],lastCaptionFrame:active.at(-1),firstBounds:bounds[0],duration:Number(info.format.duration)};
}

test('C05/C06: all three caption styles render at exact edited frames and remain inside the safe area',async()=>{
 for(const preset of ['clean','box','emphasis']){
  const output=await exportMedia(media,cuts,1,directory,{transcript,captionStyle:{...DEFAULT_CAPTION_STYLE,enabled:true,preset}});
  const evidence=await pixelEvidence(output.path,[[1,2.3],[3.001,4]],{yellow:preset==='emphasis'});assert.equal(output.burnedCaptions,2);assert.equal(output.duration,5);
  reports.push({preset,...evidence,status:'PASS'});
  await mkdir('test-output/caption-rendering',{recursive:true});await capture('ffmpeg',['-v','error','-ss','1.5','-i',output.path,'-frames:v','1','-y',`test-output/caption-rendering/${preset}.png`]);
 }
 assert.equal(createHash('sha256').update(await readFile(fixture)).digest('hex'),sourceHash);
});
test('C06: native portrait, rotation metadata and non-square pixels produce matching caption canvases',async()=>{
 for(const variant of ['portrait','rotation','sar']){
  const input=path.join(directory,`${variant}.mp4`);
  if(variant==='rotation')await capture('ffmpeg',['-v','error','-display_rotation:v:0','90','-i',fixture,'-map','0','-c','copy','-y',input]);
  else await capture('ffmpeg',['-v','error','-i',fixture,'-vf',variant==='portrait'?'scale=360:640,setsar=1':'setsar=2','-c:v','libx264','-preset','ultrafast','-c:a','copy','-y',input]);
  const item=await inspectMedia(input),style={...DEFAULT_CAPTION_STYLE,enabled:true,preset:'emphasis',position:'top'};
  assert.equal(item.width,variant==='sar'?1280:360,`${variant} fixture display width`);assert.equal(item.height,variant==='sar'?360:640,`${variant} fixture display height`);
  const output=await exportMedia(item,cuts,1,directory,{transcript,captionStyle:style});const evidence=await pixelEvidence(output.path,[[1,2.3],[3.001,4]],{yellow:true});
  assert.equal(evidence.width,variant==='sar'?1280:360);assert.equal(evidence.height,variant==='sar'?360:640);assert.ok(evidence.firstBounds.top<evidence.height*.3);
  reports.push({variant,...evidence,status:'PASS'});await capture('ffmpeg',['-v','error','-ss','1.5','-i',output.path,'-frames:v','1','-y',`test-output/caption-rendering/${variant}.png`]);
 }
});
test('C01/C05: VFR and a nonzero source PTS retain caption timing after a cut',async()=>{
 const vfr=path.join(directory,'vfr.mp4'),shifted=path.join(directory,'vfr-offset.mp4');
 await capture('ffmpeg',['-v','error','-i',fixture,'-vf',"select='if(lt(t,3),not(mod(n,2)),1)'",'-fps_mode','vfr','-c:v','libx264','-preset','ultrafast','-c:a','copy','-y',vfr]);
 await capture('ffmpeg',['-v','error','-i',vfr,'-map','0','-c','copy','-output_ts_offset','5','-y',shifted]);
 const item=await inspectMedia(shifted);assert.equal(item.origin,5);
 const inputTimes=(await capture('ffprobe',['-v','error','-select_streams','v','-show_entries','frame=pts_time','-of','csv=p=0',shifted])).split('\n').map(x=>x.replace(/,$/,'')).filter(Boolean).map(Number);
 const deltas=new Set(inputTimes.slice(1).map((time,i)=>Math.round((time-inputTimes[i])*1000)));assert.deepEqual([...deltas].sort(),[33,67]);
 const captions={...transcript,cues:[{id:'a',start:1,end:1.5,text:'가변 프레임 한글'},{id:'b',start:4.001,end:4.7,text:'두 번째 시각'}]};
 const output=await exportMedia(item,[{id:'cut',start:2,end:3,enabled:true}],1,directory,{transcript:captions,captionStyle:{...DEFAULT_CAPTION_STYLE,enabled:true,preset:'emphasis'}});
 const evidence=await pixelEvidence(output.path,[[1,1.5],[3.001,3.7]],{yellow:true});assert.equal(evidence.duration,5);reports.push({vfrAndOffset:true,...evidence,status:'PASS'});
});
test('M06/C05: range preview crops captions without changing the full export clock',async()=>{
 const style={...DEFAULT_CAPTION_STYLE,enabled:true,preset:'emphasis'};
 const preview=await exportMedia(media,cuts,1,directory,{preview:true,range:{start:2.1,end:5.1},transcript,captionStyle:style});
 const evidence=await pixelEvidence(preview.path,[[0,.2],[.901,1.9]],{yellow:true});assert.equal(evidence.duration,2);reports.push({rangePreview:true,...evidence,status:'PASS'});
});
test('C06: long Korean, Latin and explicit newlines fit up to three lines with visible resizing',async()=>{
 const samples=[{name:'two-lines',text:'한글 첫째 줄\nKorean + English 123',width:1280,height:720},{name:'portrait-long',text:'긴 한글 자막도 영상 안에 들어오도록 크기를 조절합니다. 한국어와 English captions를 함께 확인합니다.',width:360,height:640}];
 for(const sample of samples){
  const rendered=await renderCaptionImages({mode:'sample',...sample,style:{...DEFAULT_CAPTION_STYLE,preset:'box',sizePercent:8}});
  assert.ok(rendered.layout.lines>=2&&rendered.layout.lines<=3);assert.ok(rendered.layout.bounds.x>=sample.width*.04&&rendered.layout.bounds.y>=sample.height*.04);
  if(sample.name==='portrait-long')assert.ok(rendered.layout.sizePercent<8);
  await writeFile(`test-output/caption-rendering/${sample.name}.png`,Buffer.from(rendered.image.split(',')[1],'base64'));
  reports.push({sample:sample.name,...rendered.layout,status:'PASS'});
 }
});
test('C05/C06: cropped sequences reconstruct every original RGBA pixel across styles, positions and line heights',async()=>{
 const {createCanvas,loadImage}=await import('@napi-rs/canvas');
 const texts=['짧은 자막 gjpq','한글 ÅÉá\n둘째 줄 English\n마지막 줄 123'];
 for(const [width,height] of [[640,360],[360,640]])for(const preset of ['clean','box','emphasis'])for(const position of ['top','bottom']){
  const style={...DEFAULT_CAPTION_STYLE,preset,position,sizePercent:8,marginPercent:5},work=await mkdtemp(path.join(directory,'pixel-sequence-'));
  const sequence=await renderCaptionImages({mode:'sequence',directory:work,width,height,style,duration:6,cues:texts.map((text,i)=>({text,start:1+i*2,end:2+i*2}))});
  assert.equal(sequence.offsetY%2,0);assert.equal(sequence.imageHeight%2,0);assert.ok(sequence.offsetY>=0&&sequence.offsetY+sequence.imageHeight<=height);assert.ok(sequence.imageHeight<height);
  for(let i=0;i<texts.length;i++){
   const full=await renderCaptionImages({mode:'sample',width,height,style,text:texts[i]});
   const original=await loadImage(Buffer.from(full.image.split(',')[1],'base64')),cropped=await loadImage(await readFile(path.join(work,`caption-${i}.png`)));
   assert.equal(cropped.width,width);assert.equal(cropped.height,sequence.imageHeight);assert.deepEqual(sequence.layouts[i],full.layout);
   const expected=createCanvas(width,height),actual=createCanvas(width,height);expected.getContext('2d').drawImage(original,0,0);actual.getContext('2d').drawImage(cropped,0,sequence.offsetY);
   const expectedPixels=Buffer.from(expected.getContext('2d').getImageData(0,0,width,height).data),actualPixels=Buffer.from(actual.getContext('2d').getImageData(0,0,width,height).data);
   assert.ok(actualPixels.equals(expectedPixels),`${width}x${height} ${preset} ${position} cue ${i}: crop must preserve all pixels, including transparent area`);
  }
  const blank=await loadImage(await readFile(path.join(work,'caption-blank.png'))),image=createCanvas(blank.width,blank.height);image.getContext('2d').drawImage(blank,0,0);assert.ok(image.getContext('2d').getImageData(0,0,blank.width,blank.height).data.every(value=>value===0));
  reports.push({croppedPixels:true,width,height,preset,position,offsetY:sequence.offsetY,imageHeight:sequence.imageHeight,comparedCues:texts.length,status:'PASS'});
 }
});
test('M06/C05: a range with no visible captions stays pixel-identical to the same caption-free preview',async()=>{
 const style={...DEFAULT_CAPTION_STYLE,enabled:true,preset:'emphasis'},options={preview:true,range:{start:0,end:.8},transcript};
 const captioned=await exportMedia(media,cuts,1,directory,{...options,captionStyle:style}),plain=await exportMedia(media,cuts,1,directory,{...options,captionStyle:{...style,enabled:false}});
 assert.equal(captioned.burnedCaptions,0);assert.equal(captioned.duration,plain.duration);
 const frames=async file=>capture('ffmpeg',['-v','error','-i',file,'-map','0:v:0','-f','framemd5','-']);
 assert.equal(await frames(captioned.path),await frames(plain.path));
 reports.push({emptyCaptionRange:true,duration:captioned.duration,pixelIdentical:true,status:'PASS'});
});
test('C09: missing font, unsupported glyphs, excess text and cancellation fail without a false final file',async()=>{
 await assert.rejects(renderCaptionImages({mode:'sample',width:640,height:360,style:DEFAULT_CAPTION_STYLE,text:'한글'},{fontDirectory:path.join(directory,'missing-fonts')}),/글꼴 파일/);
 await assert.rejects(renderCaptionImages({mode:'sample',width:640,height:360,style:DEFAULT_CAPTION_STYLE,text:'😀'}),/지원하지 않는/);
 await assert.rejects(renderCaptionImages({mode:'sample',width:640,height:360,style:DEFAULT_CAPTION_STYLE,text:'긴'.repeat(2000)}),/너무 깁니다/);
 const controller=new AbortController(),before=new Set(await readdir(directory));let reached=false,at;
 const many={...transcript,cues:Array.from({length:1000},(_,i)=>({id:String(i),start:i*.006,end:(i+1)*.006,text:'취소 검증'}))};
 await assert.rejects(exportMedia(media,[],1,directory,{transcript:many,captionStyle:{...DEFAULT_CAPTION_STYLE,enabled:true},signal:controller.signal,progress:value=>{if(value.stage==='자막 디자인 합성 준비'&&!reached){reached=true;at=performance.now();controller.abort();}}}),{name:'AbortError'});
 assert.ok(reached);assert.ok(performance.now()-at<5000);assert.deepEqual(new Set(await readdir(directory)),before);
 const output=await exportMedia(media,[],1,directory,{transcript,captionStyle:{...DEFAULT_CAPTION_STYLE,enabled:true}});assert.equal(output.burnedCaptions,2);
});

test.after(async()=>{await mkdir('test-output',{recursive:true});await writeFile('test-output/caption-rendering-results.json',JSON.stringify(reports,null,2));await rm(directory,{recursive:true,force:true});});
