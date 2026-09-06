import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { generateDemo } from './fixtures.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';
const option=(name,fallback)=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3)||fallback;
const output=path.resolve(option('output','test-output/editor-render-e2e'));
assert.ok(output.startsWith(path.resolve('test-output')+path.sep));await mkdir(output,{recursive:true});
const reportFile=path.join(output,'results.json');assert.equal(await stat(reportFile).catch(()=>null),null,'Use a new result directory');
const report={date:new Date().toISOString(),status:'running',scope:'Real browser and packaged Mac; current cut/transport state, preview clock, project replacement and busy lock. Native file dialog responses controlled by test.',sourceHashes:{},runs:[]};
for(const p of ['src/App.tsx','src/Timeline.tsx','src/CutList.tsx','scripts/editor-render-e2e.mjs','release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'])report.sourceHashes[p]=await sha256(p);
const flush=()=>writeFile(reportFile,JSON.stringify(report,null,2)+'\n');await flush();
const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-editor-render-')),source=await generateDemo(path.join(directory,'source.mp4')),media=await inspectMedia(source);
const a=makeProject(media,DEFAULT_SETTINGS,1,[{id:'a1',start:2,end:4,enabled:true,reason:'silence'},{id:'a2',start:8,end:10,enabled:true,reason:'silence'}]);
const b=makeProject(media,DEFAULT_SETTINGS,1,[{id:'b1',start:1,end:3,enabled:true,reason:'silence'},{id:'b2',start:5,end:6,enabled:true,reason:'silence'},{id:'b3',start:12,end:14,enabled:true,reason:'silence'}]);
const aFile=path.join(directory,'a.json'),bFile=path.join(directory,'b.json');await writeFile(aFile,JSON.stringify(a));await writeFile(bFile,JSON.stringify(b));
let desktop,browser,server,page;
const button=(name)=>page.getByRole('button',{name,exact:true});
async function expectTime(expected){await page.waitForFunction(value=>Math.abs((document.querySelector('video')?.currentTime??-99)-value)<.05,expected);}
async function chooseCut(index,expected){await page.locator('.cut-select').nth(index).click();await expectTime(expected);assert.equal(await page.locator('.cut-row.selected').count(),1);assert.equal(await page.locator('.cut-row').nth(index).evaluate(el=>el.classList.contains('selected')),true);}
async function render(expectedDuration){
  await button('정확한 미리보기').click();
  await page.waitForFunction(()=>!!document.querySelector('.job-overlay'));
  assert.equal(await page.locator('.cut-row .icon-button').evaluateAll(buttons=>buttons.length>0&&buttons.every(button=>button.disabled)),true);
  await page.getByText('렌더링된 편집본',{exact:true}).waitFor({timeout:60000});
  await page.waitForFunction(duration=>document.querySelector('video')?.readyState>=2&&Math.abs(document.querySelector('video').duration-duration)<.034,expectedDuration);
  assert.equal(await page.locator('.cut-row .icon-button').evaluateAll(buttons=>buttons.every(button=>!button.disabled)),true);
}
async function exercise(surface){
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>{void dialog.accept();});
  await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);
  if(desktop){await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);await button('영상 추가').click();}
  else await page.locator('input[type=file]').first().setInputFiles(source);
  await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&!document.querySelector('.job-overlay'));
  await page.locator('input[type=file]').nth(1).setInputFiles(aFile);await page.waitForFunction(()=>document.querySelectorAll('.cut-row').length===2);
  await button('원본').click();await chooseCut(1,7.5);
  await button('무음 1 복원').focus();await page.keyboard.press('Space');assert.equal(await page.locator('.restored-row').count(),1);
  await button('무음 1 제거').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.restored-row').count(),0);
  await button('재생').click();await page.waitForFunction(()=>document.querySelector('video').currentTime>7.8);await button('일시 정지').click();await chooseCut(1,7.5);
  await render(12);await chooseCut(1,5.5);
  await button('무음 1 복원').click();await page.waitForFunction(()=>!document.querySelector('.preview-badge')?.textContent.includes('렌더링된'));
  assert.equal(await page.locator('.restored-row').count(),1);await render(14);await chooseCut(1,7.5);
  await button('실행 취소').click();assert.equal(await page.locator('.restored-row').count(),0);
  await button('다시 실행').click();assert.equal(await page.locator('.restored-row').count(),1);
  await button('원본').click();await page.locator('.timeline-cut').nth(1).click();await expectTime(7.5);
  await button('타임라인 확대').click();assert.equal(await page.locator('.timeline-cut.selected').count(),1);
  await page.locator('input[type=file]').nth(1).setInputFiles(bFile);await page.waitForFunction(()=>document.querySelectorAll('.cut-row').length===3);
  await button('원본').click();await chooseCut(2,11.5);await button('무음 3 복원').click();assert.equal(await page.locator('.restored-row').count(),1);
  await render(13);await chooseCut(2,8.5);
  const storedFile=path.join(output,`${surface}-project.json`);
  if(desktop){await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},storedFile);await button('프로젝트 저장').first().click();await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.',{exact:true}).waitFor();}
  else {const download=page.waitForEvent('download');await button('프로젝트 저장').first().click();await(await download).saveAs(storedFile);}
  const stored=JSON.parse(await readFile(storedFile,'utf8'));assert.deepEqual(stored.cuts,[b.cuts[0],b.cuts[1],{...b.cuts[2],enabled:false}]);assert.equal(stored.media.fingerprint,media.fingerprint);
  await page.screenshot({path:path.join(output,`${surface}.png`)});
  assert.deepEqual(errors,[]);assert.equal(await sha256(source),media.fingerprint);
  report.runs.push({surface,status:'PASS',playThenSelect:true,keyboardToggle:true,originalSeek:7.5,editedSeek:5.5,restoredEditedSeek:7.5,replacementSourceSeek:11.5,replacementEditedSeek:8.5,busyLockedAndReleased:true,undoRedo:true,timelineSelectAndZoom:true,fullSavedCutsMatch:true,sourcePreserved:true,pageErrors:errors});await flush();console.log(JSON.stringify(report.runs.at(-1)));
}
try{
  server=await startServer({port:0,dataDir:path.join(directory,'browser')});browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(server.url);await exercise('browser');await browser.close();browser=null;await server.close();server=null;
  desktop=await electron.launch({executablePath:path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'),args:[`--user-data-dir=${path.join(directory,'profile')}`],env:{...process.env,HYPERCUT_DATA_DIR:path.join(directory,'desktop')}});page=await desktop.firstWindow();await exercise('desktop');report.status='completed';
}catch(error){report.status='failed';report.error=error.stack;await page?.screenshot({path:path.join(output,'failure.png'),timeout:5000}).catch(()=>{});process.exitCode=1;}
finally{await flush();await browser?.close();await server?.close();if(desktop){await desktop.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await desktop.close();}await rm(directory,{recursive:true,force:true});}
console.log(JSON.stringify({status:report.status,reportFile}));
