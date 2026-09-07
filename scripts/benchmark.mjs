import { mkdir, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { capture } from '../tests/reference/server/process.mjs';
import { inspectMedia, analyzeMedia, exportMedia } from '../tests/reference/server/media.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';

const exec = promisify(execFile);
const directory = path.resolve('test-output/benchmark');
await mkdir(directory, { recursive: true });
const cycle = path.join(directory, 'cycle.mp4');
const report = { date: new Date().toISOString(), platform: `${os.platform()} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0].model, cpuCount: os.cpus().length, memoryBytes: os.totalmem(), node: process.version, ffmpeg: (await capture('ffmpeg', ['-version'])).split('\n')[0], scope: 'Synthetic low-complexity 1080p 30 fps H264/AAC48k. Backend plus child RSS sampled every 250ms, excluding browser/Electron; filesystem cache not flushed. Not full P01/P02 approval.', runs: [] };
await capture('ffmpeg', ['-v','error','-f','lavfi','-i',"color=c=0x243023:s=1920x1080:r=30:d=3.6,drawbox=x=0:y=0:w=iw:h=ih:color=white:t=fill:enable='between(t,0.4,0.6)'",'-an','-c:v','libx264','-preset','ultrafast','-crf','18','-pix_fmt','yuv420p','-y',cycle]);
let phasePeak = 0, sampling = false;
const sampleRSS = async () => {
  if (sampling) return; sampling = true;
  try {
    const { stdout } = await exec('/bin/ps', ['-axo', 'pid=,ppid=,rss=']);
    const rows = stdout.trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
    const ids = new Set([process.pid]); let changed = true;
    while (changed) { changed = false; for (const [pid, parent] of rows) if (ids.has(parent) && !ids.has(pid)) { ids.add(pid); changed = true; } }
    phasePeak = Math.max(phasePeak, rows.filter(row => ids.has(row[0])).reduce((sum,row)=>sum+row[2]*1024,0));
  } finally { sampling = false; }
};
const timer = setInterval(() => { void sampleRSS().catch(() => {}); }, 250);
try {
  for (const duration of [600, 3600]) {
    const source = path.join(directory, `${duration}s.mp4`);
    if (!(await stat(source).catch(()=>null))) {
      console.log(`Generating ${duration}s synthetic input`);
      await capture('ffmpeg', ['-v','error','-stream_loop','-1','-i',cycle,'-f','lavfi','-i',"aevalsrc='0.15*sin(2*PI*440*t)*lt(mod(t,3.6),2.6)':s=48000",'-map','0:v:0','-map','1:a:0','-c:v','copy','-c:a','aac','-b:a','128k','-t',String(duration),'-movflags','+faststart','-y',source]);
    }
    for (let iteration = 1; iteration <= 3; iteration++) {
      phasePeak = 0; const start = performance.now();
      const media = await inspectMedia(source); const analysis = await analyzeMedia(media, DEFAULT_SETTINGS, media.audioTracks[0].index);
      const analyzed = performance.now(), analyzePeakBytes = phasePeak; phasePeak = 0;
      const output = await exportMedia(media, analysis.cuts, media.audioTracks[0].index, directory);
      await sampleRSS();
      const result = { inputSeconds: media.duration, inputBytes: media.size, fingerprint: media.fingerprint, iteration, cache: iteration === 1 ? 'first analysis in process; fixture freshly written or OS cache unknown' : 'warm OS cache; new media object', analyzeSeconds: (analyzed-start)/1000, exportSeconds: (performance.now()-analyzed)/1000, analyzePeakBytes, exportPeakBytes: phasePeak, cuts: analysis.cuts.length, outputSeconds: output.duration, outputBytes: output.size, fullDecodeVerified: output.verified };
      report.runs.push(result); await writeFile(path.join(directory, 'results.json'), JSON.stringify(report,null,2)); console.log(JSON.stringify(result));
      // Preserve the last output for independent long-timeline inspection.
      if (iteration < 3) await rm(output.path); else { report[`output${duration}`] = output.path; await writeFile(path.join(directory, 'results.json'), JSON.stringify(report,null,2)); }
    }
  }
} finally { clearInterval(timer); }
