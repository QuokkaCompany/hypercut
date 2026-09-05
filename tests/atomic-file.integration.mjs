import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, readdir, chmod } from 'node:fs/promises';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import os from 'node:os';
import path from 'node:path';
import { atomicReplace } from '../server/atomic-file.mjs';

test('E03: killing the real writer before commit preserves the last complete project', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-atomic-'));
  let child;
  try {
    const target = path.join(directory, 'project.json'); const original = '{"complete":"previous"}';
    await writeFile(target, original);
    const script = path.join(directory, 'writer.mjs');
    await writeFile(script, `import { writeFile } from 'node:fs/promises';\nimport { atomicReplace } from ${JSON.stringify(new URL('../server/atomic-file.mjs', import.meta.url).href)};\nawait atomicReplace(process.argv[2], file => writeFile(file, '{"complete":"next"}', {flag:'wx'}), {beforeCommit:async()=>{process.send('ready');await new Promise(()=>{})}});`);
    child = fork(script, [target], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    assert.deepEqual(await once(child, 'message'), ['ready', undefined]);
    const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
    assert.equal(await readFile(target, 'utf8'), original);
    assert.equal(JSON.parse(await readFile(target, 'utf8')).complete, 'previous');
    await atomicReplace(target, file => writeFile(file, '{"complete":"retry"}', { flag: 'wx' }));
    assert.equal(JSON.parse(await readFile(target, 'utf8')).complete, 'retry');
  } finally { child?.kill(); await rm(directory, { recursive: true, force: true }); }
});
test('E02: actual OS write permission failure leaves the old destination intact', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-permission-'));
  try {
    const target = path.join(directory, 'project.json'); await writeFile(target, 'original');
    await chmod(directory, 0o500);
    await assert.rejects(atomicReplace(target, file => writeFile(file, 'next', { flag: 'wx' })), e => ['EACCES', 'EPERM'].includes(e.code));
    assert.equal(await readFile(target, 'utf8'), 'original');
    await chmod(directory, 0o700);
    assert.deepEqual(await readdir(directory), ['project.json']);
    await atomicReplace(target, file => writeFile(file, 'retry', { flag: 'wx' }));
    assert.equal(await readFile(target, 'utf8'), 'retry');
  } finally { await chmod(directory, 0o700); await rm(directory, { recursive: true, force: true }); }
});
test('E02: injected disk-full during writing cleans the partial file and preserves destination', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-space-'));
  try {
    const target = path.join(directory, 'project.json'); await writeFile(target, 'original');
    await assert.rejects(atomicReplace(target, async file => { await writeFile(file, 'partial'); throw Object.assign(new Error('test volume full'), { code: 'ENOSPC' }); }), { code: 'ENOSPC' });
    assert.equal(await readFile(target, 'utf8'), 'original'); assert.deepEqual(await readdir(directory), ['project.json']);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
