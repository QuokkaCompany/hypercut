import { _electron as electron } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
const exec=promisify(execFile), directory=await mkdtemp(path.join(os.tmpdir(),'hypercut-desktop-perf-'));
let desktop,timer;
const report={date:new Date().toISOString(),platform:`${os.platform()} ${os.release()} ${os.arch()}`,cpu:os.cpus()[0].model,memoryBytes:os.totalmem(),scope:'Packaged Electron, native file selection response controlled by test. Full app process tree RSS at 250ms intervals; excludes test driver. Other desktop apps not stopped. OS caches not purged.',power:(await exec('/usr/bin/pmset',['-g','batt'])).stdout.trim(),runs:[]};
try {
  desktop=await electron.launch({executablePath:path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'),args:[],env:{...process.env,HYPERCUT_DATA_DIR:directory}});
  const page=await desktop.firstWindow(); await page.waitForFunction(()=>!document.querySelector('.import-button')?.disabled);
  const root=desktop.process().pid;let peak=0,sampling=false;
  async function sample(){if(sampling)return;sampling=true;try{
    const rows=(await exec('/bin/ps',['-axo','pid=,ppid=,rss='])).stdout.trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number));
    const ids=new Set([root]);let changed=true;
    while(changed){changed=false;for(const[pid,parent]of rows)if(ids.has(parent)&&!ids.has(pid)){ids.add(pid);changed=true;}}
    peak=Math.max(peak,rows.filter(row=>ids.has(row[0])).reduce((sum,row)=>sum+row[2]*1024,0));
  }finally{sampling=false;}}
  timer=setInterval(()=>{void sample().catch(()=>{});},250);
  for(const duration of [600,3600])for(let iteration=1;iteration<=3;iteration++){
    const source=path.resolve(`test-output/benchmark/${duration}s.mp4`);
    await desktop.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},source);
    peak=0;const begin=performance.now();
    await page.getByRole('button',{name:'영상 추가',exact:true}).click();
    await page.waitForFunction(()=>!document.querySelector('.job-overlay')&&document.querySelector('video')?.readyState>=2,null,{timeout:60000});
    await page.locator('.analyze-button').click();await page.locator('.job-overlay').waitFor({state:'hidden',timeout:180000});
    const analyzeSeconds=(performance.now()-begin)/1000,analyzePeakBytes=peak,cuts=await page.locator('.cut-row').count();peak=0;
    assert.equal(cuts,duration===3600?1000:166);
    const exporting=performance.now();await page.getByRole('button',{name:'내보내기',exact:true}).click();
    await page.getByRole('button',{name:'편집한 MP4 저장',exact:true}).waitFor({timeout:600000});
    const exportSeconds=(performance.now()-exporting)/1000;await sample();
    const result={inputSeconds:duration,iteration,cache:iteration===1?'first app run for this input; OS cache unknown':'warm app and OS caches',analyzeSeconds,exportSeconds,analyzePeakBytes,exportPeakBytes:peak,cuts,outputReady:true};
    report.runs.push(result);await writeFile(path.resolve('test-output/benchmark/desktop-results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(result));
    await desktop.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(directory,'project.json'));
    await page.getByRole('button',{name:'프로젝트 저장',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.unsaved-dot'));
    assert.equal(JSON.parse(await readFile(path.join(directory,'project.json'),'utf8')).cuts.length,cuts);
  }
}finally{clearInterval(timer);await desktop?.close();await rm(directory,{recursive:true,force:true});}
