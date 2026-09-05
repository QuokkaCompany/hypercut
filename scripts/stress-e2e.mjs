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
  for(let i=0;i<32;i++) {
    const measured = await page.evaluate(async(index)=>{
      const target = index%2 ? document.querySelector('button[aria-label="실행 취소"]') : document.querySelector('button[aria-label="무음 1 복원"]');
      const start = performance.now(); target.click();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      return { milliseconds: performance.now()-start, restored: document.querySelectorAll('.restored-row').length };
    },i);
    assert.equal(measured.restored, i%2 ? 0 : 1); latencies.push(measured.milliseconds);
  }
  const sorted = [...latencies].sort((a,b)=>a-b), p95 = sorted[Math.ceil(sorted.length*.95)-1]; assert.ok(p95<=200);
  await page.locator('.analyze-button').click(); await page.getByRole('button',{name:'작업 취소',exact:true}).waitFor();
  const cancelStart = performance.now(); await page.getByRole('button',{name:'작업 취소',exact:true}).click();
  await page.locator('.job-overlay').waitFor({state:'hidden',timeout:5000});
  const cancelMs = performance.now()-cancelStart; assert.ok(cancelMs<5000); assert.equal(await page.locator('.cut-row').count(),1000);
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.resolve('test-output/stress-1000-cuts.png')});
  const result = { scope:'Browser 60-minute input, 1000 actual cuts, 32 restore/undo click-to-two-paints samples. No full app RSS measurement.', status:'PASS',latencies,p95Ms:p95,cancelAnalysisMs:cancelMs,cutsPreserved:1000,pageErrors:0 };
  await writeFile(path.resolve('test-output/benchmark/ui-stress.json'),JSON.stringify(result,null,2)); console.log(JSON.stringify(result));
} finally { await browser?.close(); await server?.close(); await rm(directory,{recursive:true,force:true}); }
