import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../server/app.mjs';
import { inspectMedia } from '../server/media.mjs';
import { generateDemo } from './fixtures.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';
const option = (name, fallback) => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const surfaces = option('surfaces', 'browser,desktop').split(',');
assert.ok(surfaces.every(s => ['browser','desktop'].includes(s)));
const output = path.resolve(option('output', 'test-output/windowed-lists'));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
await mkdir(output, { recursive: true });
const reportFile = path.join(output, 'results.json'); assert.equal(await stat(reportFile).catch(() => null), null, 'Choose a new output directory');
const report = { date: new Date().toISOString(), status: 'running', scope: '1000 synthetic cuts and captions in actual browser/packaged Mac. Native keyboard navigation, viewport rendering, long text, selection/draft/review/delete/undo, project replacement and whole-state persistence. No media-performance or human-quality claim.', sourceHashes: {}, runs: [] };
for (const file of ['src/WindowedList.tsx','src/CutList.tsx','src/CaptionList.tsx','src/Captions.tsx','src/styles.css','src/captions.css','scripts/windowed-lists-e2e.mjs','package-lock.json','dist/index.html']) report.sourceHashes[file] = await sha256(file);
if (surfaces.includes('desktop')) report.sourceHashes['release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'] = await sha256('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar');
const flush = () => writeFile(reportFile, JSON.stringify(report, null, 2) + '\n'); await flush();
const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-windowed-lists-'));
let browser, server, desktop, page;
try {
  const source = await generateDemo(path.join(directory, 'source.mp4')), media = await inspectMedia(source);
  const cues = Array.from({ length: 1000 }, (_, i) => ({ id: `cue-${i}`, start: Number((i * .007).toFixed(6)), end: Number((i * .007 + .006).toFixed(6)), text: i === 499 ? Array.from({length:12}, (_,j) => `긴 문구 ${j + 1} — 전체 한글과 줄바꿈을 보존합니다.`).join('\n') : `목록 검증 ${i + 1}` }));
  const cuts = Array.from({length:1000}, (_,i) => ({id:`cut-${i}`, start:i ? 8+i*.006 : cues[499].start+.002, end:i ? 8+i*.006+.003 : cues[499].start+.003, enabled:true, reason:'silence'}));
  const initial = { format:'hypercut-project',version:7,media:{name:media.name,fingerprint:media.fingerprint,duration:media.duration},settings:{...DEFAULT_SETTINGS},speechProtection:{enabled:false,threshold:.5},trackIndex:1,cuts,transcript:{trackIndex:1,channel:0,language:'ko',model:'manual windowed fixture',cues},captionStyle:{...DEFAULT_CAPTION_STYLE},effects:{assets:[],clips:[]},glossary:'',savedAt:'2026-09-06T00:00:00.000Z' };
  const projectFile=path.join(output,'input-project.json');await writeFile(projectFile,JSON.stringify(initial,null,2));
  const small={...initial,cuts:cuts.slice(0,2),transcript:{...initial.transcript,cues:cues.slice(0,2)}};
  const smallFile=path.join(output,'small-project.json');await writeFile(smallFile,JSON.stringify(small,null,2));
  const content=({savedAt,...rest})=>rest;
  for(const surface of surfaces){
    if(surface==='browser'){server=await startServer({port:0,dataDir:path.join(directory,'browser')});browser=await chromium.launch({channel:'chrome',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000}});await page.goto(server.url);}
    else {desktop=await electron.launch({executablePath:path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'),args:[`--user-data-dir=${path.join(directory,'profile')}`],env:{...process.env,HYPERCUT_DATA_DIR:path.join(directory,'desktop')}});page=await desktop.firstWindow();}
    const run={surface,status:'running',captionTabStops:0,cutTabStops:0,snapshots:[]}, errors=[], external=[];report.runs.push(run);await flush();
    page.on('pageerror',e=>errors.push(e.message));page.on('request',req=>{if(!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(req.url()))external.push(req.url());});
    const button=name=>page.locator(`button[aria-label="${name}"]`);
    const nativeFocus=async()=>page.evaluate(()=>({name:document.activeElement?.getAttribute('aria-label'),cut:document.activeElement?.getAttribute('data-cut-id'),action:document.activeElement?.getAttribute('data-cut-action')}));
    async function edge(selector,key){const target=page.locator(selector).first();await target.focus();await target.press(key);}
    async function snapshot(phase){
      const data=await page.evaluate(()=>({cutCount:Number(document.querySelector('.cut-list')?.dataset.itemCount),cutRows:document.querySelectorAll('.cut-row').length,captionCount:Number(document.querySelector('.caption-list')?.dataset.itemCount),captionRows:document.querySelectorAll('.caption-row').length,nodes:document.querySelectorAll('*').length}));
      assert.ok(data.cutRows>0&&data.cutRows<80);if(data.captionCount)assert.ok(data.captionRows>0&&data.captionRows<80);run.snapshots.push({phase,...data});
    }
    await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);
    if(desktop){await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);await button('영상 추가').click();}
    else await page.locator('input[type=file]').first().setInputFiles(source);
    await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&!document.querySelector('.job-overlay'));
    await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
    await page.locator('.cut-list[data-item-count="1000"]').waitFor();await snapshot('large-cuts');await page.screenshot({path:path.join(output,`${surface}-cuts.png`)});
    await edge('.cut-select','End');assert.equal((await nativeFocus()).cut,'cut-999');await page.keyboard.press('Enter');
    await page.waitForFunction(t=>Math.abs(document.querySelector('video').currentTime-t)<.001,cuts.at(-1).start-.5);
    await button('무음 1000 복원').focus();await page.keyboard.press('Space');await button('무음 1000 제거').waitFor();await page.keyboard.press('Enter');await button('무음 1000 복원').waitFor();
    await edge('.cut-select','Home');
    for(let i=0;i<80;i++){const f=await nativeFocus();assert.equal(f.cut,`cut-${Math.floor(i/2)}`);assert.equal(f.action,i%2?'toggle':'select');run.cutTabStops++;await page.keyboard.press('Tab');}
    for(let i=79;i>=0;i--){await page.keyboard.press('Shift+Tab');const f=await nativeFocus();assert.equal(f.cut,`cut-${Math.floor(i/2)}`);assert.equal(f.action,i%2?'toggle':'select');}
    await page.locator('.cut-list').evaluate(el=>{el.scrollTop=el.scrollHeight/2;});await page.waitForTimeout(100);assert.equal((await nativeFocus()).cut,'cut-0');await snapshot('focused-cut-kept-outside-viewport');
    await edge('.cut-select','End');await page.keyboard.press('Tab');assert.equal((await nativeFocus()).name,'무음 1000 복원');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.cut-list')),false);
    await button('전사와 자막').click();await page.locator('.caption-list[data-item-count="1000"]').waitFor();await snapshot('large-captions');
    await edge('.caption-row','Home');
    for(let i=0;i<1000;i++){
      assert.equal((await nativeFocus()).name,`자막 ${i+1} 선택`);run.captionTabStops++;
      if(i===499){assert.equal(await button('자막 500 선택').locator('p').textContent(),cues[499].text);assert.ok(await button('자막 500 선택').evaluate(el=>el.getBoundingClientRect().height)>300);await snapshot('long-multiline-caption');}
      await page.keyboard.press('Tab');
    }
    assert.equal(await page.evaluate(()=>!!document.activeElement?.closest('.caption-list')),false);
    console.log(JSON.stringify({surface,phase:'all-thousand-native-caption-tab-stops'}));
    await edge('.caption-row','End');await page.keyboard.press('Enter');
    const text=page.locator('textarea[aria-label="자막 문구"]'),last=cues.at(-1);
    await page.waitForFunction(t=>document.querySelector('textarea[aria-label="자막 문구"]')?.value===t,last.text);
    await text.fill('아직 적용하지 않은 문구');await edge('.caption-row','Home');page.once('dialog',d=>void d.dismiss());await page.keyboard.press('Enter');assert.equal(await text.inputValue(),'아직 적용하지 않은 문구');assert.equal(await page.locator('.caption-row.selected').getAttribute('aria-label'),'자막 1000 선택');
    page.once('dialog',d=>void d.accept());await page.keyboard.press('Space');await page.waitForFunction(t=>document.querySelector('textarea[aria-label="자막 문구"]')?.value===t,cues[0].text);
    await page.getByRole('button',{name:'다음 검토 자막으로 이동',exact:true}).click();await page.waitForFunction(t=>document.querySelector('textarea[aria-label="자막 문구"]')?.value===t,cues[499].text);
    assert.equal(await page.locator('.caption-row.selected').getAttribute('aria-label'),'자막 500 선택');
    await page.waitForFunction(()=>{const a=document.querySelector('.caption-row.selected').getBoundingClientRect(),b=document.querySelector('.caption-list').getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom;});
    if(surface==='browser'){await page.setViewportSize({width:680,height:1000});await page.waitForFunction(()=>{const a=document.querySelector('.caption-row.selected').getBoundingClientRect(),b=document.querySelector('.caption-list').getBoundingClientRect();return a.bottom>b.top&&a.top<b.bottom;});assert.equal(await button('자막 500 선택').locator('p').textContent(),cues[499].text);await page.screenshot({path:path.join(output,'browser-narrow.png')});await page.setViewportSize({width:1440,height:1000});}
    await page.getByRole('button',{name:'이 자막 삭제',exact:true}).click();await page.locator('.caption-list[data-item-count="999"]').waitFor();assert.equal(await text.inputValue(),cues[0].text);await button('자막 실행 취소').click();await page.locator('.caption-list[data-item-count="1000"]').waitFor();assert.equal(await text.inputValue(),cues[499].text);
    await edge('.caption-row','End');await page.keyboard.press('Space');const changed={...last,start:Number((last.start+.001).toFixed(6)),text:`${last.text} 수정`};
    await text.fill(changed.text);await page.locator('input[aria-label="자막 시작"]').fill(String(changed.start));await page.locator('.caption-fields button[type=submit]').click();await page.waitForFunction(t=>document.querySelector('.caption-row.selected p')?.textContent===t,changed.text);
    await button('자막 실행 취소').click();assert.equal(await text.inputValue(),last.text);await button('자막 다시 실행').click();assert.equal(await text.inputValue(),changed.text);
    await page.waitForFunction(()=>{const video=document.querySelector('video[aria-label="자막 원본 청취"]');return video.readyState>=2&&!video.seeking;});
    await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();await snapshot('after-edit-undo-redo');await page.screenshot({path:path.join(output,`${surface}-captions.png`)});await button('자막 창 닫기').click();
    const saved=path.join(output,`${surface}-project.json`);
    if(desktop){await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},saved);await button('프로젝트 저장').first().click();await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.',{exact:true}).waitFor();}
    else {const download=page.waitForEvent('download');await button('프로젝트 저장').first().click();await(await download).saveAs(saved);}
    const stored=JSON.parse(await readFile(saved,'utf8'));assert.deepEqual(content(stored),content({...initial,transcript:{...initial.transcript,cues:[...cues.slice(0,-1),changed]}}));
    await page.locator('input[type=file]').nth(1).setInputFiles(smallFile);await page.locator('.cut-list[data-item-count="2"]').waitFor();assert.equal(await page.locator('.cut-row').count(),2);await button('전사와 자막').click();await page.locator('.caption-list[data-item-count="2"]').waitFor();assert.equal(await page.locator('.caption-row').count(),2);await button('자막 창 닫기').click();
    await page.locator('input[type=file]').nth(1).setInputFiles(saved);await page.locator('.cut-list[data-item-count="1000"]').waitFor();await button('전사와 자막').click();await edge('.caption-row','End');await page.keyboard.press('Enter');assert.equal(await text.inputValue(),changed.text);assert.equal(Number(await page.locator('input[aria-label="자막 시작"]').inputValue()),changed.start);await button('자막 창 닫기').click();
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);assert.equal(await sha256(source),media.fingerprint);
    Object.assign(run,{status:'PASS',cutTabReverse:true,homeEndAndEnterSpace:true,focusPreserved:true,unappliedDraftProtected:true,reviewJump:true,multilinePreserved:true,deleteUndo:true,editUndoRedo:true,smallLargeReplacement:true,wholeProjectPreserved:true,sourcePreserved:true,pageErrors:errors,externalRequests:external.length});await flush();console.log(JSON.stringify({surface,status:run.status,cutTabStops:run.cutTabStops,captionTabStops:run.captionTabStops,snapshots:run.snapshots}));
    await browser?.close();browser=null;await server?.close();server=null;await desktop?.close();desktop=null;
  }
  report.status='completed';
}catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png'),timeout:5000}).catch(()=>{});}
finally{await flush();await browser?.close();await server?.close();if(desktop){await desktop.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await desktop.close();}await rm(directory,{recursive:true,force:true});}
console.log(JSON.stringify({status:report.status,reportFile,error:report.error}));
