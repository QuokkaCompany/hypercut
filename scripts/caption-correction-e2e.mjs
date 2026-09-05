import { chromium, _electron as electron } from 'playwright';
import { mkdtemp,mkdir,rm,readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { capture } from '../server/process.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject,DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-correction-ui-')),results=[];
const original='캡컶에서 10분을 편집햇어요.',corrected='캡컷에서 10분을 편집했어요.';
const transcript={trackIndex:1,channel:0,language:'ko',model:'manual test fixture',cues:[{id:'a',start:1,end:2.5,text:original},{id:'b',start:7,end:8.5,text:'소리를 없애지 않습니다.'},{id:'c',start:10,end:11,text:'이 자막은 보존합니다.'}]};
let browser,desktop,server;
try{
 await mkdir('test-output',{recursive:true});const video=await generateDemo(path.join(directory,'fixture.mp4')),media=await inspectMedia(video);
 const projectPath=path.join(directory,'fixture.hypercut.json');await writeFile(projectPath,JSON.stringify(makeProject(media,DEFAULT_SETTINGS,1,[{id:'cut',start:3,end:5,enabled:true}],undefined,transcript,{...DEFAULT_CAPTION_STYLE,enabled:true,preset:'emphasis'})));
 async function exercise(page,surface){
  const errors=[],external=[];page.on('pageerror',error=>errors.push(error.message));page.on('request',req=>{if(!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url()))external.push(req.url());});
  await page.locator('input[type=file]').nth(1).setInputFiles(projectPath);await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
  await page.getByRole('button',{name:'전사와 자막',exact:true}).click();await page.getByRole('button',{name:'현재부터 3개 AI 교정',exact:true}).click();
  const panel=page.getByRole('dialog',{name:'AI 자막 교정',exact:true});
  await page.getByRole('textbox',{name:'교정 참고 용어',exact:true}).fill('캡컶 → 캡컷');await page.getByRole('button',{name:'AI에게 보낼 요청 복사',exact:true}).click();
  await page.getByText('보낼 요청 보기',{exact:true}).click();
  const prompt=await page.getByRole('textbox',{name:'복사용 AI 요청',exact:true}).inputValue(),input=JSON.parse(prompt.split('\nRequest: ').at(-1));assert.equal(input.cues.length,3);assert.ok(!prompt.includes(media.fingerprint));assert.ok(!prompt.includes('"start"'));assert.ok(!prompt.includes('fixture.mp4'));
  const proposal={requestId:input.requestId,changes:[{id:'a',before:original,after:corrected,reason:'앱 이름과 맞춤법 교정'},{id:'b',before:transcript.cues[1].text,after:'소리를 없앱니다.',reason:'의미가 바뀌는 모의 제안'}]};
  const response=page.getByRole('textbox',{name:'AI JSON 응답',exact:true});
  await response.fill(JSON.stringify({...proposal,changes:[{...proposal.changes[0],after:'캡컷에서 100분을 편집했어요.'}]}));await page.getByRole('button',{name:'응답 확인',exact:true}).click();await page.getByRole('alert').filter({hasText:'숫자가 달라지는'}).waitFor();
  await response.fill(JSON.stringify(proposal));await page.getByRole('button',{name:'응답 확인',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'선택한 0개 교정 적용',exact:true}).isEnabled(),false);
  assert.equal(await page.getByRole('checkbox',{name:'교정 제안 2 적용 선택',exact:true}).isEnabled(),false);
  await page.getByRole('checkbox',{name:'교정 제안 2 의미 확인',exact:true}).check();await page.getByRole('checkbox',{name:'교정 제안 2 적용 선택',exact:true}).check();await page.getByRole('checkbox',{name:'교정 제안 2 적용 선택',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'교정 제안 1 적용 선택',exact:true}).check();await page.locator('.correction-review').scrollIntoViewIfNeeded();await page.screenshot({path:`test-output/correction-${surface}.png`});
  if(surface==='browser'){await page.setViewportSize({width:390,height:844});await page.locator('.correction-review').scrollIntoViewIfNeeded();await page.screenshot({path:'test-output/correction-mobile.png'});const box=await panel.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=390,JSON.stringify(box));await page.setViewportSize({width:1440,height:1000});}
  await page.getByRole('button',{name:'선택한 1개 교정 적용',exact:true}).click();await page.getByRole('dialog',{name:'전사와 자막 편집'}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'자막 문구',exact:true}).inputValue(),corrected);assert.equal(await page.getByRole('spinbutton',{name:'자막 시작',exact:true}).inputValue(),'1');
  await page.getByRole('button',{name:'자막 2 선택',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'자막 문구',exact:true}).inputValue(),transcript.cues[1].text);
  await page.getByRole('button',{name:'자막 1 선택',exact:true}).click();await page.getByRole('button',{name:'자막 실행 취소',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'자막 문구',exact:true}).inputValue(),original);await page.getByRole('button',{name:'자막 다시 실행',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'자막 문구',exact:true}).inputValue(),corrected);
  await page.getByRole('button',{name:'이 자막 AI 교정',exact:true}).click();await page.getByRole('button',{name:'AI에게 보낼 요청 복사',exact:true}).click();await page.getByRole('textbox',{name:'AI JSON 응답',exact:true}).fill(JSON.stringify(proposal));await page.getByRole('button',{name:'응답 확인',exact:true}).click();await page.getByRole('alert').filter({hasText:'현재 요청'}).waitFor();
  // Intercept only this disposable UI's local request. No real model is called.
  let calls=0,release;let delayed=true;
  await page.route('**/api/ai/correction',async route=>{if(route.request().method()!=='POST'){await route.continue();return;}calls++;const body=route.request().postDataJSON();if(delayed)await new Promise(resolve=>{release=resolve;});await route.fulfill({json:{requestId:body.requestId,changes:[]}}).catch(()=>{});});
  await page.getByLabel('사용할 AI',{exact:true}).selectOption('ollama');await page.getByLabel('모델 이름',{exact:true}).fill('fixture-only-model');await page.getByRole('button',{name:'연결 설정 저장',exact:true}).click();await page.getByRole('button',{name:'연결 해제',exact:true}).waitFor();assert.equal(calls,0);
  await page.getByRole('button',{name:'로컬 AI에 제안 요청',exact:true}).click();for(let i=0;i<100&&!release;i++)await new Promise(resolve=>setTimeout(resolve,10));assert.ok(release);
  await page.getByRole('button',{name:'요청 취소',exact:true}).click();await page.getByText('AI 요청을 취소했습니다.',{exact:true}).waitFor();release();delayed=false;
  await page.getByRole('button',{name:'로컬 AI에 제안 요청',exact:true}).click();await page.getByText('AI가 수정할 문구를 제안하지 않았습니다. 원문은 그대로입니다.',{exact:true}).waitFor();assert.equal(calls,2);await page.unroute('**/api/ai/correction');
  await page.getByRole('button',{name:'AI 창 닫기',exact:true}).click();
  const srtPath=path.join(directory,`${surface}.srt`),savedProject=path.join(directory,`${surface}.json`),mp4Path=path.join(directory,`${surface}.mp4`);
  async function save(button,file,notice){if(surface==='desktop'){await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},file);await button.click();await page.getByText(notice,{exact:true}).waitFor();}else{const download=page.waitForEvent('download');await button.click();await(await download).saveAs(file);}}
  await save(page.getByRole('button',{name:'편집한 SRT 저장',exact:true}),srtPath,'편집한 자막을 저장했습니다.');const srt=await readFile(srtPath,'utf8');assert.ok(srt.includes(corrected));assert.ok(srt.includes('소리를 없애지 않습니다.'));assert.ok(srt.includes('00:00:05,000 --> 00:00:06,500'));assert.ok(!srt.includes(original));
  await page.getByRole('button',{name:'자막 창 닫기',exact:true}).click();await save(page.getByRole('button',{name:'프로젝트 저장',exact:true}).first(),savedProject,'프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.');
  const stored=JSON.parse(await readFile(savedProject,'utf8'));assert.equal(stored.transcript.cues[0].text,corrected);assert.deepEqual(stored.transcript.cues.map(({start,end})=>({start,end})),transcript.cues.map(({start,end})=>({start,end})));
  await page.getByRole('button',{name:'내보내기',exact:true}).click();await page.locator('.export-ready').waitFor();await save(page.getByRole('button',{name:'편집한 MP4 저장',exact:true}),mp4Path,'편집한 영상을 저장했습니다.');await capture('ffmpeg',['-v','error','-xerror','-i',mp4Path,'-f','null','-']);await capture('ffmpeg',['-v','error','-ss','1.5','-i',mp4Path,'-frames:v','1','-y',`test-output/correction-export-${surface}.png`]);
  assert.deepEqual(errors,[]);assert.deepEqual(external,[]);results.push({surface,status:'PASS',models:'NOT_RUN: manual JSON and intercepted local UI response only',numericChangeRejected:true,negationReview:true,onlySelectedApplied:true,timingPreserved:true,undoRedo:true,oldRequestRejected:true,cancelAndRetry:true,srt,projectSaved:true,styledMP4SavedAndDecoded:true,pageErrors:errors,externalRequests:external.length});
 }
 server=await startServer({port:0,dataDir:path.join(directory,'web')});browser=await chromium.launch({channel:'chrome',headless:true});let page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(server.url);await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);await page.locator('input[type=file]').first().setInputFiles(video);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await exercise(page,'browser');await browser.close();browser=null;
 if(process.argv.includes('--desktop')){desktop=await electron.launch({executablePath:path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'),args:[],env:{...process.env,HYPERCUT_DATA_DIR:path.join(directory,'desktop')}});page=await desktop.firstWindow();await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},video);await page.getByRole('button',{name:'영상 추가',exact:true}).click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);await exercise(page,'desktop');}
}catch(error){console.error(error);if(desktop){desktop.process().kill('SIGKILL');desktop=null;}throw error;}
finally{await desktop?.close();await browser?.close();await server?.close();await rm(directory,{recursive:true,force:true});}
await writeFile('test-output/caption-correction-e2e.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
