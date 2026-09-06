import {chromium,_electron as electron} from 'playwright';
import {startServer} from '../server/app.mjs';
import {mkdtemp,mkdir,readFile,writeFile,rm,stat} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {createCanvas,loadImage} from '@napi-rs/canvas';
import {sha256} from './helpers/transcription-performance-fixture.mjs';
const output=path.resolve(process.argv.find(x=>x.startsWith('--output='))?.slice(9)||'test-output/caption-preview-layout-apps');
assert.ok(output.startsWith(path.resolve('test-output')+path.sep));await mkdir(output,{recursive:true});
const reportFile=path.join(output,'results.json');assert.equal(await stat(reportFile).catch(()=>null),null,'Choose a new output directory');
const report={date:new Date().toISOString(),status:'running',scope:'Actual browser and packaged Mac caption-design thumbnail. Three styles, browser wide/narrow and native Mac size. Complete image rectangle inside preview and visible text pixels after image decode. No export or human caption-quality claim.',sourceHashes:{},runs:[]};
for(const f of ['src/captions.css','src/CaptionStyle.tsx','scripts/caption-preview-layout-e2e.mjs','dist/index.html','release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'])report.sourceHashes[f]=await sha256(f);
const dir=await mkdtemp(path.join(os.tmpdir(),'hypercut-caption-preview-layout-'));let server,browser,desktop,page;
try{
 for(const surface of ['browser','desktop']){
  const errors=[],run={surface,status:'running',conditions:[]};report.runs.push(run);
  if(surface==='browser'){server=await startServer({port:0,dataDir:path.join(dir,'browser')});browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(server.url);}
  else{desktop=await electron.launch({executablePath:path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'),args:[`--user-data-dir=${path.join(dir,'profile')}`],env:{...process.env,HYPERCUT_DATA_DIR:path.join(dir,'desktop')}});page=await desktop.firstWindow();}
  page.on('dialog',dialog=>{void dialog.accept().catch(()=>{});});page.on('pageerror',e=>errors.push(e.message));await page.locator('.demo-button').click();await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&!document.querySelector('.job-overlay'));await page.locator('button[aria-label="전사와 자막"]').click();
  await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();await page.locator('.caption-design-preview img').evaluate(img=>img.decode());
  for(const width of surface==='browser'?[1440,680]:[null]){
   if(width)await page.setViewportSize({width,height:1000});
   for(const style of ['기본형','배경 박스','강조형']){
    const response=page.waitForResponse(res=>res.url().endsWith("/api/captions/style-preview")&&res.request().method()==="POST"&&res.ok());
    await page.locator(`button[aria-label="자막 스타일 ${style}"]`).click();await response;await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();await page.locator('.caption-design-preview img').evaluate(img=>img.decode());
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const box=page.locator('.caption-design-preview');await box.scrollIntoViewIfNeeded();
    const geometry=await box.evaluate(el=>{const img=el.querySelector('img'),a=el.getBoundingClientRect(),b=img.getBoundingClientRect();return {container:{width:a.width,height:a.height},image:{width:b.width,height:b.height,left:b.left-a.left,top:b.top-a.top,naturalWidth:img.naturalWidth,naturalHeight:img.naturalHeight}};});
    const {container:c,image:i}=geometry;assert.ok(i.naturalWidth>0&&i.naturalHeight>0);assert.ok(i.top>=-1&&i.left>=-1&&i.top+i.height<=c.height+1&&i.left+i.width<=c.width+1,'Complete caption thumbnail must fit the visible preview');
    const png=path.join(output,`${surface}-${width||'native'}-${style}.png`);await box.screenshot({path:png});const decoded=await loadImage(await readFile(png)),canvas=createCanvas(decoded.width,decoded.height),ctx=canvas.getContext('2d');ctx.drawImage(decoded,0,0);const pixels=ctx.getImageData(0,0,decoded.width,decoded.height).data;let ink=0;
    for(let y=12;y<decoded.height-12;y++)for(let x=12;x<decoded.width-12;x++){const j=(y*decoded.width+x)*4;if(Math.abs(pixels[j]-52)+Math.abs(pixels[j+1]-68)+Math.abs(pixels[j+2]-85)>40)ink++;}
    assert.ok(ink>20,'Caption text must be visible inside the preview, not only present in an offscreen image');run.conditions.push({width,style,geometry,visibleInkPixels:ink,png,sha256:await sha256(png)});
   }
  }
  assert.deepEqual(errors,[]);run.status='PASS';run.pageErrors=errors;console.log(JSON.stringify({surface,status:run.status,conditions:run.conditions.length}));
  await page.locator('button[aria-label="자막 창 닫기"]').click();
  const saved=path.join(output,`${surface}-project.json`);
  if(desktop){await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);await page.locator('button[aria-label="프로젝트 저장"]:visible').first().click();await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.',{exact:true}).waitFor();}
  else{const [download]=await Promise.all([page.waitForEvent('download'),page.locator('button[aria-label="프로젝트 저장"]:visible').first().click()]);await download.saveAs(saved);}
  await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
  await browser?.close();browser=null;await server?.close();server=null;if(desktop){await desktop.close();desktop=null;}
 }
 report.status='completed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png'),timeout:5000}).catch(()=>{});}
finally{await browser?.close();await server?.close();if(desktop){await desktop.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await desktop.close();}await rm(dir,{recursive:true,force:true});await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');}
console.log(JSON.stringify({status:report.status,reportFile,error:report.error}));
