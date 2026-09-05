import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if(process.platform!=='darwin')throw new Error('This OS-level network isolation test requires macOS.');
// This profile applies to the browser test runner, local server and their children.
// Only loopback connections required by the local application and debugger are allowed.
const profile='(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
const exec=promisify(execFile);
const probe="const net=require('node:net');const s=net.connect({host:'203.0.113.1',port:443});s.on('error',e=>console.log(e.code));s.setTimeout(1000,()=>{console.log('TIMEOUT');s.destroy()});";
const denial=(await exec('/usr/bin/sandbox-exec',['-p',profile,process.execPath,'-e',probe])).stdout.trim();
assert.ok(['EPERM','EACCES'].includes(denial),`Network isolation probe: ${denial}`);
const child=spawn('/usr/bin/sandbox-exec',['-p',profile,process.execPath,path.resolve('scripts/e2e.mjs')],{stdio:'inherit',env:process.env});
const [code,signal]=await once(child,'exit');assert.equal(code,0,`Offline E2E exited ${code}/${signal}`);
const result={status:'PASS',externalConnectionProbe:denial,profile,scope:'OS sandbox denies non-loopback network for browser and local server full editing flow. Probe uses reserved TEST-NET IP; E2E uses only synthetic files and manual AI JSON import.',desktopOSIsolation:'NOT_RUN: Electron renderer cannot initialize its own sandbox inside sandbox-exec (Operation not permitted). Default app security has not been weakened to make this test pass.'};
await writeFile(path.resolve('test-output/offline-e2e.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
