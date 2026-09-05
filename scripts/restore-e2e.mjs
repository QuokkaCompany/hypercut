import { chromium } from 'playwright';
import { mkdtemp,rm,writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { capture } from '../server/process.mjs';

const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-restore-ui-'));
let server,browser;
try{
  const source=path.join(directory,'silent.mp4');
  await capture('ffmpeg',['-v','error','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=4','-f','lavfi','-i','anullsrc=r=48000:cl=mono','-t','4','-c:v','libx264','-preset','ultrafast','-c:a','aac','-y',source]);
  server=await startServer({port:0,dataDir:directory});browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:960},acceptDownloads:true});
  await page.goto(server.url);await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);
  await page.locator('input[type=file]').first().setInputFiles(source);await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);
  await page.locator('.analyze-button').click();await page.getByRole('button',{name:'무음 1 복원',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'내보내기',exact:true}).isDisabled(),true);
  await page.getByText('모든 구간이 제거되어 내보낼 수 없습니다. 필요한 구간을 복원해 주세요.',{exact:true}).waitFor();
  await page.getByRole('button',{name:'일부 구간 복원',exact:true}).click();
  await page.getByLabel('복원 시작 (초)').fill('1.01');await page.getByLabel('복원 끝 (초)').fill('1.99');
  await page.getByRole('button',{name:'이 범위 복원',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.cut-row').length===3);
  assert.match(await page.locator('.result-summary').innerText(),/2개 구간 제거 · 1개 복원/);
  await page.getByRole('button',{name:'정확한 미리보기',exact:true}).click();await page.getByText('렌더링된 편집본',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2);assert.ok(Math.abs(await page.locator('video').evaluate(v=>v.duration)-1)<0.04);
  await page.getByRole('button',{name:'내보내기',exact:true}).click();await page.getByRole('button',{name:'편집한 MP4 저장',exact:true}).waitFor();
  const downloading=page.waitForEvent('download');await page.getByRole('button',{name:'편집한 MP4 저장',exact:true}).click();
  const output=path.join(directory,'restored.mp4');await(await downloading).saveAs(output);await capture('ffmpeg',['-v','error','-xerror','-i',output,'-f','null','-']);
  // Shortcuts must still work after clicking a button (the focused element is a button).
  await page.keyboard.press('Meta+z');await page.waitForFunction(()=>document.querySelectorAll('.cut-row').length===1);
  assert.equal(await page.getByRole('button',{name:'내보내기',exact:true}).isDisabled(),true);
  await page.keyboard.press('Meta+Shift+z');await page.waitForFunction(()=>document.querySelectorAll('.cut-row').length===3);
  await page.locator('.timeline-cut').first().click();await page.keyboard.press('r');
  assert.match(await page.locator('.result-summary').innerText(),/1개 구간 제거 · 2개 복원/);
  await page.keyboard.press('Meta+z');assert.match(await page.locator('.result-summary').innerText(),/2개 구간 제거 · 1개 복원/);
  await page.getByRole('button',{name:'일부 구간 복원',exact:true}).click();await page.getByLabel('복원 시작 (초)').fill('3');await page.getByLabel('복원 끝 (초)').fill('2');
  assert.equal(await page.getByRole('button',{name:'이 범위 복원',exact:true}).isDisabled(),true);await page.getByRole('button',{name:'복원 창 닫기',exact:true}).click();
  await page.getByRole('button',{name:'전체 복원',exact:true}).click();assert.match(await page.locator('.result-summary').innerText(),/0개 구간 제거 · 3개 복원/);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:path.resolve('test-output/restore-mobile.png'),fullPage:true});
  const result={status:'PASS',fullySilentEmptyOutputBlocked:true,partialRestoration:[1,2],verifiedOutputSeconds:1,invalidRangeBlocked:true,keyboardUndoRedoRestore:true,restoreAll:true,mobileOverflow:false};
  await writeFile(path.resolve('test-output/restore-e2e.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();await server?.close();await rm(directory,{recursive:true,force:true});}
