import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { runCLI } from './reference/server/claude-cli.mjs';

test('A06: real subprocess keeps shell syntax on stdin and reconstructs split Korean UTF-8', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cli-bytes-'));
  try {
    const script = path.join(directory, "fake ' CLI.mjs");
    await writeFile(script, "let data='';for await (const chunk of process.stdin)data+=chunk;const b=Buffer.from(JSON.stringify({text:'한국어 제안',input:data}));for(const value of b)process.stdout.write(Buffer.from([value]));");
    const payload = '$(touch should-not-exist) `touch also-not`';
    const result = await runCLI(process.execPath, [script], { cwd: directory, input: payload });
    assert.equal(result.code, 0); assert.deepEqual(JSON.parse(result.stdout), { text: '한국어 제안', input: payload });
    await assert.rejects(readFile(path.join(directory, 'should-not-exist')), { code: 'ENOENT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('A04: timeout and oversized subprocess output terminate and return bounded errors', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cli-timeout-'));
  try {
    await assert.rejects(runCLI(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { cwd: directory, timeoutMs: 50 }), { code: 'CLI_TIMEOUT' });
    await assert.rejects(runCLI(process.execPath, ['-e', "process.stdout.write('x'.repeat(300000));setInterval(()=>{},1000)"], { cwd: directory }), { code: 'CLI_OUTPUT' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('A04/A08: cancellation terminates the actual process group including a stubborn descendant', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-cli-cancel-'));
  let descendant;
  try {
    const pidFile = path.join(directory, 'child.pid');
    const code = `const {spawn}=require('node:child_process');const fs=require('node:fs');const c=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'});setTimeout(()=>fs.writeFileSync(${JSON.stringify(pidFile)},String(c.pid)),100);setInterval(()=>{},1000);`;
    const controller = new AbortController();
    const result = runCLI(process.execPath, ['-e', code], { cwd: directory, signal: controller.signal }).then(value => ({ value }), error => ({ error }));
    for (let i = 0; i < 200; i++) { const value = await readFile(pidFile, 'utf8').catch(() => null); if (value) { descendant = Number(value); break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(descendant); const start = performance.now(); controller.abort();
    assert.equal((await result).error?.code, 'CLI_CANCELLED'); assert.ok(performance.now() - start < 2000);
    for (let i = 0; i < 200; i++) { try { process.kill(descendant, 0); } catch { descendant = null; break; } await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(descendant, null, 'descendant remains alive after cancellation');
  } finally { if (descendant) try { process.kill(descendant, 'SIGKILL'); } catch {} await rm(directory, { recursive: true, force: true }); }
});
