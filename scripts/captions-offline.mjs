import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

if (process.platform !== 'darwin') throw new Error('This network isolation check requires macOS.');
const profile = '(version 1)(allow default)(deny network-outbound)(allow network-outbound (remote ip "localhost:*"))';
const probe = "const net=require('node:net');const s=net.connect({host:'203.0.113.1',port:443});s.on('error',e=>console.log(e.code));s.setTimeout(1000,()=>{console.log('TIMEOUT');s.destroy()});";
const denial = (await promisify(execFile)('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, '-e', probe])).stdout.trim();
assert.ok(['EPERM', 'EACCES'].includes(denial), `Network isolation probe: ${denial}`);
const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, process.execPath, path.resolve('scripts/captions-e2e.mjs')], { stdio: 'inherit', env: process.env });
const [code, signal] = await once(child, 'exit'); assert.equal(code, 0, `Caption offline E2E exited ${code}/${signal}`);
const result = { status: 'PASS', externalConnectionProbe: denial, profile, scope: 'OS non-loopback network denial applied to actual browser, local server, bundled VAD and Whisper inference, caption editing, style renderer, SRT and burned-in MP4 export. Generated Korean TTS only.', desktopOSIsolation: 'NOT_RUN: nested Electron sandbox limitation recorded in recovery report; native app security remains enabled.' };
await writeFile(path.resolve('test-output/captions-offline.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
