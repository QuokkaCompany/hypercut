import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../tests/reference/server/app.mjs';
import { generateDemo } from './fixtures.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(),'hypercut-ui-recovery-'));
let server,browser,releaseOld;
try {
  const source = await generateDemo(path.join(directory,'source.mp4'));
  let aiMode='delayed', aiStarted, aiReply;
  server = await startServer({port:0,dataDir:directory,aiFetch: async()=>{
    if(aiMode==='error') return new Response('mock failure',{status:503});
    aiStarted?.(); return new Promise(resolve=>{aiReply=()=>resolve(Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({settings:{thresholdDb:-10,minSilenceMs:50,preRollMs:0,postRollMs:0},explanation:'late proposal'})}]}]}));});
  }});
  browser = await chromium.launch({channel:'chrome',headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:960}}), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(server.url); await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(source);
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await page.locator('.analyze-button').click(); await page.getByRole('button',{name:'무음 1 복원',exact:true}).waitFor();
  await page.getByRole('button',{name:'무음 1 복원',exact:true}).click();
  const brokenProject=path.join(directory,'broken.json');await writeFile(brokenProject,'{"incomplete":');
  page.once('dialog',dialog=>void dialog.accept());
  await page.locator('input[type=file]').nth(1).setInputFiles(brokenProject);
  await page.locator('.error-toast').waitFor();assert.match(await page.locator('.result-summary').innerText(),/4개 구간 제거 · 1개 복원/);
  await page.getByRole('button',{name:'오류 닫기',exact:true}).click();
  let acknowledge; const intercepted=new Promise(resolve=>{acknowledge=resolve;});
  let delayed=true;
  await page.route('**/api/jobs',async route=>{
    if(delayed && route.request().method()==='POST') {
      delayed=false; acknowledge();
      await new Promise(resolve=>{releaseOld=resolve;});
      await route.continue().catch(()=>{});
    } else await route.continue();
  });
  await page.locator('.analyze-button').click(); await intercepted;
  assert.equal(await page.getByRole('spinbutton',{name:'음량 임계값',exact:true}).isDisabled(),true);
  const start=performance.now(); await page.getByRole('button',{name:'작업 취소',exact:true}).click();
  await page.locator('.job-overlay').waitFor({state:'hidden',timeout:5000});
  const cancelBeforeAckMs=performance.now()-start;
  assert.match(await page.locator('.result-summary').innerText(),/4개 구간 제거 · 1개 복원/);
  await page.getByRole('spinbutton',{name:'최소 무음 길이',exact:true}).fill('2.5');
  await page.locator('.analyze-button').click(); await page.locator('.job-overlay').waitFor({state:'hidden',timeout:10000});
  releaseOld(); await page.unroute('**/api/jobs');
  assert.equal(await page.locator('.cut-row').count(),0); assert.equal(await page.locator('.stale-notice').count(),0);

  await page.getByRole('button',{name:'AI 편집 도우미',exact:true}).click();
  await page.getByLabel('사용할 AI').selectOption('openai');
  await page.getByLabel('모델 이름',{exact:true}).fill('test-model'); await page.getByLabel('API 키',{exact:true}).fill('not-a-real-key');
  await page.getByRole('button',{name:'연결 설정 저장',exact:true}).click(); await page.getByRole('button',{name:'연결 해제',exact:true}).waitFor();
  const incoming=new Promise(resolve=>{aiStarted=resolve;});
  await page.getByRole('button',{name:'제안 요청 · API 사용',exact:true}).click(); await incoming;
  await page.getByRole('button',{name:'AI 창 닫기',exact:true}).click();
  await page.getByRole('spinbutton',{name:'음량 임계값',exact:true}).fill('-60');
  aiReply();
  await page.getByRole('button',{name:'AI 편집 도우미',exact:true}).click();
  assert.equal(await page.locator('.ai-proposal').count(),0);
  aiMode='error'; await page.getByRole('button',{name:'제안 요청 · API 사용',exact:true}).click();
  await page.locator('.ai-error').filter({hasText:'서버 오류'}).waitFor();
  await page.getByRole('button',{name:'AI 창 닫기',exact:true}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'음량 임계값',exact:true}).inputValue(),'-60');
  await page.locator('.analyze-button').click(); await page.locator('.job-overlay').waitFor({state:'hidden'});
  await page.getByRole('button',{name:'내보내기',exact:true}).click();
  await page.getByRole('button',{name:'편집한 MP4 저장',exact:true}).waitFor({timeout:30000});
  assert.equal(await page.locator('.cut-row').count(),0);
  assert.equal(await page.evaluate(()=>JSON.stringify([localStorage,sessionStorage]).includes('not-a-real-key')),false);
  assert.deepEqual(errors,[]);
  const result={status:'PASS',cancelBeforeAckMs,oldCutEditsPreserved:true,staleAnalysisRejected:true,staleAIProposalRejected:true,localExportAfterAIFailure:true,pageErrors:errors,scope:'Real browser/media with delayed job request and injected AI responses; no external AI calls'};
  await writeFile(path.resolve('test-output/recovery-e2e.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { releaseOld?.(); await browser?.close(); await server?.close(); await rm(directory,{recursive:true,force:true}); }
