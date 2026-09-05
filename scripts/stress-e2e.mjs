import { chromium } from 'playwright';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-stress-'));
let server, browser;
try {
  server = await startServer({ port: 0, dataDir: directory });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.url); await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(path.resolve('test-output/benchmark/3600s.mp4'));
  await page.waitForFunction(()=>!!document.querySelector('video'),null,{timeout:30000});
  await page.locator('.analyze-button').click();
  await page.waitForFunction(()=>document.querySelectorAll('.cut-row').length===1000,null,{timeout:120000});
  const latencies = [];
  const samples = [];
  for(let i=0;i<32;i++) {
    const measured = await page.evaluate(async(index)=>{
      const target = index%2 ? document.querySelector('button[aria-label="실행 취소"]') : document.querySelector('button[aria-label="무음 1 복원"]');
      const start = performance.now(); target.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return { milliseconds: performance.now()-start, restored: document.querySelectorAll('.restored-row').length };
    },i);
    assert.equal(measured.restored, i%2 ? 0 : 1); latencies.push(measured.milliseconds);samples.push({action:i%2?'undo':'restore',ms:measured.milliseconds});
  }
  for(let i=0;i<16;i++){
    const start=performance.now();await page.getByRole('spinbutton',{name:'음량 임계값',exact:true}).fill(i%2?'-40':'-41');
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('.stale-notice').count(),i%2?0:1);
    const ms=performance.now()-start;latencies.push(ms);samples.push({action:'setting',ms});
  }
  for(let i=0;i<16;i++){
    const start=performance.now();await page.getByRole('button',{name:i%2?'일시 정지':'재생',exact:true}).click();
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.locator('video').evaluate(v=>v.paused),!!(i%2));
    const ms=performance.now()-start;latencies.push(ms);samples.push({action:i%2?'pause':'play',ms});
  }
  const sorted = [...latencies].sort((a,b)=>a-b), p95 = sorted[Math.ceil(sorted.length*.95)-1]; assert.ok(p95<=200);
  await page.getByRole('button',{name:'원본',exact:true}).click();await page.locator('.timeline-title').click();
  await page.keyboard.press('Space');await page.waitForFunction(()=>!document.querySelector('video').paused);
  await page.keyboard.press('Space');await page.waitForFunction(()=>document.querySelector('video').paused);
  const beforeSeek=await page.locator('video').evaluate(v=>v.currentTime);await page.keyboard.press('ArrowRight');
  await page.waitForFunction(t=>Math.abs(document.querySelector('video').currentTime-t-5)<0.1,beforeSeek);
  await page.keyboard.press('ArrowLeft');await page.waitForFunction(t=>Math.abs(document.querySelector('video').currentTime-t)<0.1,beforeSeek);
  for(let i=0;i<5;i++)await page.getByRole('button',{name:'타임라인 확대',exact:true}).click();
  await page.locator('.timeline-cut').nth(400).click();assert.equal(await page.locator('.timeline-cut.selected').count(),1);
  const cancellation=[];
  for(const type of ['analyze','preview','export']){
    if(type==='analyze')await page.locator('.analyze-button').click();else await page.getByRole('button',{name:type==='preview'?'정확한 미리보기':'내보내기',exact:true}).click();
    await page.getByRole('button',{name:'작업 취소',exact:true}).waitFor();
    if(type!=='analyze')await page.getByText(type==='preview'?'정확한 미리보기 생성':'영상 렌더링',{exact:true}).waitFor({timeout:60000});
    const start=performance.now();
    const feedback=await page.evaluate(async()=>{
      const start=performance.now();[...document.querySelectorAll('button')].find(button=>button.textContent==='작업 취소').click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return {ms:performance.now()-start,text:document.querySelector('.job-card strong')?.textContent||document.querySelector('.notice-toast')?.textContent||''};
    });
    assert.ok(feedback.ms<300);assert.match(feedback.text,/취소/);
    await page.locator('.job-overlay').waitFor({state:'hidden',timeout:5000});
    const terminalMs=performance.now()-start;assert.ok(terminalMs<5000);assert.equal(await page.locator('.cut-row').count(),1000);
    cancellation.push({type,feedbackMs:feedback.ms,terminalMs});
  }
  await page.locator('.analyze-button').click();await page.locator('.job-overlay').waitFor({state:'hidden',timeout:60000});assert.equal(await page.locator('.cut-row').count(),1000);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.resolve('test-output/stress-1000-cuts.png')});
  const result = { scope:'Browser 60-minute input, 1000 actual cuts, 64 restore/undo/settings/play/pause samples. Settings and transport include Playwright locator overhead; all include two paints. OS process memory measured separately in desktop benchmark.', status:'PASS',samples,latencies,p95Ms:p95,cancellation,keyboardSpaceAndSeeking:true,retryAfterCancel:true,cutsPreserved:1000,pageErrors:0 };
  await writeFile(path.resolve('test-output/benchmark/ui-stress.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await server?.close(); await rm(directory,{recursive:true,force:true}); }
