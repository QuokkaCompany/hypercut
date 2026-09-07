import { chromium, _electron as electron } from 'playwright';
import { fork, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { rssSampler, summarize } from './helpers/performance.mjs';
import { transcriptionFixture, sha256 } from './helpers/transcription-performance-fixture.mjs';
import { inspectMedia, publicMedia } from '../tests/reference/server/media.mjs';
import { capture } from '../tests/reference/server/process.mjs';
import { DEFAULT_SETTINGS, validateProject } from '../shared/timeline.mjs';
import { VAD_MODEL } from '../tests/reference/server/vad.mjs';

const exec = promisify(execFile);
const option = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const durations = option('durations', '600,3600').split(',').map(Number), iterations = Number(option('iterations', '3')), surfaces = option('surfaces', 'browser,desktop').split(',');
assert.ok(durations.every(value => [60,600,3600].includes(value)) && [1,3].includes(iterations) && surfaces.every(value => ['browser','desktop'].includes(value)));
const output = path.resolve(option('output', 'test-output/vad-performance'));
assert.ok(output.startsWith(path.resolve('test-output') + path.sep)); await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'results.json');
if (await stat(reportPath).catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('Results exist; choose a new --output.');
const report = { date: new Date().toISOString(), code: (await exec('git',['rev-parse','HEAD'])).stdout.trim(), status: 'running', platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, cpuCount: os.cpus().length, memoryBytes: os.totalmem(), node: process.version, power: (await exec('/usr/bin/pmset',['-g','batt'])).stdout.trim(), ffmpeg: (await capture('ffmpeg',['-version'])).split('\n')[0], requested: {durations, iterations, surfaces}, settings: DEFAULT_SETTINGS, speechProtection: {enabled:true,threshold:.5}, scope: 'Repeated quiet Korean TTS; actual local VAD and real app import/analyze/export. Whole app tree RSS at 250ms, driver excluded. UI timings include Playwright overhead and two animation frames. No OS cache purge, no human quality or cold-cache claim. Native file paths controlled by test.', sourceHashes:{}, fixtures:[], runs:[], cancellations:[], failures:[] };
for (const file of ['src/WindowedList.tsx', 'src/CutList.tsx', 'src/App.tsx','server/media.mjs','server/vad.mjs','scripts/vad-benchmark.mjs','scripts/helpers/performance.mjs','assets/models/silero_vad.onnx','package-lock.json','release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar']) report.sourceHashes[file] = await sha256(file);
const flush = () => writeFile(reportPath, JSON.stringify(report,null,2)+'\n'); await flush();
const button = (page,name) => page.getByRole('button',{name,exact:true});
const paints = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const content = project => { const {savedAt,...rest} = validateProject(project); return rest; };
const cutContent = cuts => cuts.map(({start,end,enabled}) => ({start,end,enabled}));
let active;
async function fixture(seconds) {
  const directory = path.resolve('test-output/vad-performance-fixtures'); await mkdir(directory,{recursive:true});
  const original = await transcriptionFixture(path.resolve('test-output/transcription-performance-fixtures'),seconds), source = path.join(directory,`${seconds}s.mp4`), manifest = path.join(directory,`${seconds}s.json`);
  const previous = await readFile(manifest,'utf8').then(JSON.parse).catch(() => null);
  if (previous?.originalFingerprint === original.media.fingerprint && await stat(source).catch(() => null) && await sha256(source) === previous.media.fingerprint) return {...previous,source};
  await capture('ffmpeg',['-v','error','-nostdin','-i',original.source,'-map','0:v:0','-map','0:a:0','-c:v','copy','-af','volume=0.006','-c:a','aac','-b:a','128k','-movflags','+faststart','-y',source]);
  const media = publicMedia(await inspectMedia(source));
  assert.ok(Math.abs(media.duration-seconds)<1/30); assert.equal(media.width,1920); assert.equal(media.height,1080); assert.equal(media.fps,30); assert.equal(media.audioTracks[0].sampleRate,48000);
  const result = {kind:'Repeated generated quiet Korean TTS, not human recording',originalFingerprint:original.media.fingerprint,volumeMultiplier:.006,voice:original.voice,cycleSeconds:original.cycleSeconds,spokenSeconds:original.spokenSeconds,media};
  await writeFile(manifest,JSON.stringify(result,null,2)); return {...result,source};
}
async function launch(surface,dataDir) {
  if (surface === 'desktop') {
    const desktop = await electron.launch({executablePath:path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'),args:[`--user-data-dir=${path.join(dataDir,'profile')}`],env:{...process.env,HYPERCUT_DATA_DIR:path.join(dataDir,'media')}}), page = await desktop.firstWindow();
    return {desktop,page,roots:[desktop.process().pid],async close(){await desktop.evaluate(({dialog})=>{dialog.showMessageBoxSync=()=>1;}).catch(()=>{});await desktop.close();}};
  }
  const backend = fork(new URL('./benchmark-server.mjs',import.meta.url),[],{env:{...process.env,HYPERCUT_BENCHMARK_DATA_DIR:dataDir},stdio:['ignore','ignore','inherit','ipc']});
  const ready = await Promise.race([once(backend,'message').then(([value])=>value),once(backend,'exit').then(([code])=>{throw new Error(`Backend exited before ready: ${code}`);})]);
  const chrome = await chromium.launchServer({channel:'chrome',headless:true}), browser = await chromium.connect(chrome.wsEndpoint()), page = await browser.newPage({viewport:{width:1440,height:1000}}); await page.goto(ready.url);
  return {page,roots:[backend.pid,chrome.process().pid],async close(){await browser.close();await chrome.close();const ended=once(backend,'exit');backend.kill('SIGTERM');await ended;}};
}
async function saveProject(page,destination) {
  if (await button(page,'알림 닫기').count()) await button(page,'알림 닫기').click();
  if (active.desktop) {await active.desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},destination);await button(page,'프로젝트 저장').first().click();await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.',{exact:true}).waitFor();}
  else {const download=page.waitForEvent('download');await button(page,'프로젝트 저장').first().click();await(await download).saveAs(destination);}
  return JSON.parse(await readFile(destination,'utf8'));
}
async function measureUI(page) {
  const samples=[];
  for (const family of ['restore','settings','transport']) {
    if (family==='transport') {await button(page,'원본').click();await page.locator('video').evaluate(video=>{video.currentTime=0;});await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2);}
    for(let i=0;i<32;i++) {
      const target=family==='restore'?button(page,i%2?'실행 취소':'무음 1 복원'):family==='settings'?page.getByRole('spinbutton',{name:'음량 임계값',exact:true}):button(page,i%2?'일시 정지':'재생');
      await target.scrollIntoViewIfNeeded(); const start=performance.now();
      if(family==='settings') await target.fill(i%2?'-40':'-39'); else await target.click();
      if(family==='restore') await page.waitForFunction(count=>document.querySelectorAll('.restored-row').length===count,i%2?0:1);
      else if(family==='settings') await page.waitForFunction(stale=>!!document.querySelector('.stale-notice')===stale,!(i%2));
      else await page.waitForFunction(paused=>document.querySelector('video')?.paused===paused,!!(i%2));
      await paints(page); samples.push({family,index:i,action:family==='restore'?(i%2?'undo':'restore'):family==='settings'?'setting':i%2?'pause':'play',ms:performance.now()-start});
    }
  }
  return {samples,byFamily:Object.fromEntries(['restore','settings','transport'].map(family=>[family,summarize(samples.filter(sample=>sample.family===family).map(sample=>sample.ms))]))};
}
async function exercise(surface,input) {
  const directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-vad-perf-'));let sampler,phase,iteration,currentId;
  const jobs=new Map(),errors=[],external=[];
  const resources=async(name)=>{const memory=await sampler.stop();sampler=null;const file=`${surface}-${Math.round(input.media.duration)}-${iteration}-${name}-resources.json`;await writeFile(path.join(output,file),JSON.stringify(memory,null,2));assert.deepEqual(memory.errors,[]);assert.ok(memory.samples.length>0);return {file,peakBytes:memory.peakBytes,samples:memory.samples.length,errors:memory.errors};};
  try {
    active=await launch(surface,directory);const {page}=active;page.setDefaultTimeout(30000);
    page.on('dialog',dialog=>{if(dialog.type()==='confirm')void dialog.accept();});page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url()))external.push(request.url());});
    page.on('response',async response=>{if(/\/api\/jobs\/[0-9a-f-]+$/.test(response.url())&&response.request().method()==='GET'){const job=await response.json().catch(()=>null);if(job)jobs.set(job.id,job);}});
    await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);await page.getByRole('switch',{name:'말소리 보호',exact:true}).check();
    const config=await(await page.request.get(new URL('/api/config',page.url()).href)).json(),headers={'X-Hypercut-Token':config.token};
    async function start(type) {const post=page.waitForResponse(response=>response.url().endsWith('/api/jobs')&&response.request().method()==='POST');const started=performance.now();await(type==='analyze'?page.locator('.analyze-button'):button(page,'내보내기')).click();const response=await post,job=await response.json();assert.equal(response.status(),202,JSON.stringify(job));currentId=job.id;return started;}
    async function waitForState(predicate) {const deadline=performance.now()+Math.max(180000,input.media.duration*1500);let lastLog=0;while(performance.now()<deadline){const job=jobs.get(currentId);if(job?.status==='failed')throw new Error(job.error);if(job&&predicate(job))return job;if(performance.now()-lastLog>15000){console.log(JSON.stringify({surface,seconds:input.media.duration,iteration,phase,job:currentId,status:job?.status,stage:job?.stage,progress:job?.progress}));lastLog=performance.now();}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Timed out waiting for ${currentId}`);}
    let referenceCuts,cancelResult;
    for(iteration=1;iteration<=iterations;iteration++) {
      phase='import-and-analyze';sampler=rssSampler(active.roots);await sampler.start();
      if(active.desktop)await active.desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},input.source);
      const started=performance.now();
      if(active.desktop)await button(page,'영상 추가').click();else await page.locator('input[type=file]').first().setInputFiles(input.source);
      await page.waitForFunction(()=>document.querySelector('video')?.readyState>=2&&!document.querySelector('.job-overlay'),undefined,{timeout:180000});const importSeconds=(performance.now()-started)/1000;
      await start('analyze');const analysisJob=await waitForState(job=>job.status==='completed');await page.waitForFunction(()=>!document.querySelector('.job-overlay')&&document.querySelectorAll('.cut-row').length>0);await paints(page);
      const analyzeSeconds=(performance.now()-started)/1000,analyzeMemory=await resources('analysis'),analysis=analysisJob.result;
      assert.equal(analysis.protection.model,VAD_MODEL);assert.ok(analysis.protection.intervals.length>0);assert.ok(analysis.protection.retainedSeconds>0);assert.ok(Math.max(...analysis.peaks)<10**(-40/20));assert.equal(analysis.candidates.length,1);assert.ok(Math.abs(analysis.decodedSamples-input.media.duration*48000)<=1);assert.equal(Number(await page.locator('.cut-list').getAttribute('data-item-count')),analysis.cuts.length);
      const cuts=cutContent(analysis.cuts);for(let i=0;i<cuts.length;i++){assert.ok(cuts[i].start>=0&&cuts[i].end<=input.media.duration&&cuts[i].end>cuts[i].start);if(i)assert.ok(cuts[i].start>=cuts[i-1].end);}
      if(referenceCuts)assert.deepEqual(cuts,referenceCuts);else referenceCuts=cuts;
      await writeFile(path.join(output,`${surface}-${Math.round(input.media.duration)}-${iteration}-analysis.json`),JSON.stringify(analysis,null,2));
      phase='export';sampler=rssSampler(active.roots);await sampler.start();const exportStart=await start('export'),exportJob=await waitForState(job=>job.status==='completed');await button(page,'편집한 MP4 저장').waitFor({timeout:180000});await paints(page);const exportSeconds=(performance.now()-exportStart)/1000,exportMemory=await resources('export');
      assert.equal(exportJob.result.verified,true);const expectedDuration=input.media.duration-cuts.reduce((sum,cut)=>sum+cut.end-cut.start,0);assert.ok(Math.abs(exportJob.result.duration-expectedDuration)<=1/30);
      phase='ui';sampler=rssSampler(active.roots);await sampler.start();const ui=await measureUI(page),uiMemory=await resources('ui');
      const stored=await saveProject(page,path.join(output,`${surface}-${Math.round(input.media.duration)}-${iteration}-project.json`));assert.deepEqual(cutContent(stored.cuts),referenceCuts);assert.deepEqual(stored.speechProtection,{enabled:true,threshold:.5});
      const peakRSSBytes=Math.max(analyzeMemory.peakBytes,exportMemory.peakBytes,uiMemory.peakBytes),result={surface,inputSeconds:input.media.duration,iteration,cache:iteration===1?'fresh app process; OS cache not purged':'same app after previous iteration; OS cache not purged',viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight})),importSeconds,analyzeSeconds,exportSeconds,peakRSSBytes,resources:{analysis:analyzeMemory,export:exportMemory,ui:uiMemory},cuts:cuts.length,speechIntervals:analysis.protection.intervals.length,retainedSeconds:analysis.protection.retainedSeconds,analysisPeak:Math.max(...analysis.peaks),decodedSamples:analysis.decodedSamples,outputSeconds:exportJob.result.duration,expectedOutputSeconds:expectedDuration,fullDecodeVerified:exportJob.result.verified,ui,goals:{analysis:analyzeSeconds<=input.media.duration*.2,export:exportSeconds<=input.media.duration,memory:peakRSSBytes<=2*1024**3,ui:Object.values(ui.byFamily).every(value=>value.p95!==null&&value.p95<=200)},pageErrors:[...errors],externalRequests:external.length};
      report.runs.push(result);if(iteration===2&&cancelResult)cancelResult.retryCompletedIteration=2;await flush();console.log(JSON.stringify({surface,inputSeconds:result.inputSeconds,iteration,analyzeSeconds,exportSeconds,peakRSSBytes,cuts:result.cuts,ui:ui.byFamily,goals:result.goals}));assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
      if(iteration===1&&iterations>1){
        phase='cancel';await start('analyze');await waitForState(job=>job.status==='running'&&job.progress>=.55);
        await page.evaluate(()=>{window.__vadCancelAt=null;window.__vadCancelFeedback=null;const observer=new MutationObserver(()=>{if(window.__vadCancelAt!==null&&window.__vadCancelFeedback===null&&/취소/.test(document.querySelector('.job-card strong')?.textContent||document.querySelector('.notice-toast')?.textContent||'')){window.__vadCancelFeedback=performance.now()-window.__vadCancelAt;observer.disconnect();}});observer.observe(document.body,{subtree:true,childList:true,characterData:true});document.addEventListener('click',event=>{if(event.target.closest?.('button')?.textContent==='작업 취소')window.__vadCancelAt=performance.now();},{capture:true,once:true});});
        const startCancel=performance.now();await button(page,'작업 취소').click();await page.waitForFunction(()=>!document.querySelector('.job-overlay'));const readyMs=performance.now()-startCancel,displayMs=await page.evaluate(()=>window.__vadCancelFeedback);
        const job=await(await page.request.get(new URL(`/api/jobs/${currentId}`,page.url()).href,{headers})).json();assert.equal(job.status,'cancelled');assert.equal(await page.locator('.analyze-button').isEnabled(),true);
        assert.deepEqual(content(await saveProject(page,path.join(output,`${surface}-${Math.round(input.media.duration)}-cancel-project.json`))),content(stored));assert.ok(displayMs!==null);
        cancelResult={surface,inputSeconds:input.media.duration,jobStatus:job.status,readyMs,displayMs,projectPreserved:true,displayPass:displayMs<=300,readyPass:readyMs<=5000,retryCompletedIteration:null};report.cancellations.push(cancelResult);await flush();
      }
    }
    assert.equal(await sha256(input.source),input.media.fingerprint);report.fixtures.find(value=>value.media.fingerprint===input.media.fingerprint).sourcePreserved=true;
  } catch(error) {
    let memory;if(sampler){memory=await sampler.stop();sampler=null;await writeFile(path.join(output,`${surface}-${Math.round(input.media.duration)}-${iteration}-${phase}-failed-resources.json`),JSON.stringify(memory,null,2));}
    report.failures.push({surface,inputSeconds:input.media.duration,iteration,phase,job:jobs.get(currentId),error:error.stack,peakRSSBytes:memory?.peakBytes,pageErrors:errors,externalRequests:external});await flush();await active?.page.screenshot({path:path.join(output,`${surface}-${Math.round(input.media.duration)}-failure.png`),timeout:5000}).catch(()=>{});throw error;
  } finally {await sampler?.stop();await active?.close();active=undefined;await rm(directory,{recursive:true,force:true});}
}
try {
  for(const seconds of durations){const input=await fixture(seconds);report.fixtures.push({...input,source:path.relative(process.cwd(),input.source)});await flush();for(const surface of surfaces)await exercise(surface,input);}
  report.summary=[];for(const seconds of durations)for(const surface of surfaces){const runs=report.runs.filter(run=>run.surface===surface&&Math.abs(run.inputSeconds-seconds)<1);report.summary.push({surface,seconds,analyzeSeconds:summarize(runs.map(run=>run.analyzeSeconds)),exportSeconds:summarize(runs.map(run=>run.exportSeconds)),peakRSSBytes:summarize(runs.map(run=>run.peakRSSBytes)),allMeasuredGoalsPass:runs.every(run=>Object.values(run.goals).every(Boolean))});}
  report.status='completed';report.measuredGoalsPass=report.summary.every(value=>value.allMeasuredGoalsPass)&&report.cancellations.every(value=>value.displayPass&&value.readyPass&&value.retryCompletedIteration===2);if(!report.measuredGoalsPass)process.exitCode=1;
} catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
finally{await flush();}
console.log(JSON.stringify({status:report.status,measuredGoalsPass:report.measuredGoalsPass,reportPath}));
