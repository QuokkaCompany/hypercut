import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, statfs, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { atomicReplace } from '../server/atomic-file.mjs';
import { generateDemo } from '../scripts/fixtures.mjs';
import { inspectMedia, exportMedia } from '../server/media.mjs';

const exec = promisify(execFile);
test('E02: real ENOSPC in a disposable 32MiB volume preserves project, source and retry', { skip: process.platform !== 'darwin', timeout: 60000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-volume-'));
  const mount = path.join(directory, 'mount'); await mkdir(mount);
  let attached = false;
  try {
    const image = path.join(directory, 'bounded.sparseimage');
    await exec('/usr/bin/hdiutil', ['create', '-size', '32m', '-fs', 'HFS+', '-volname', 'HyperCut-test', '-type', 'SPARSE', '-nospotlight', image]);
    await exec('/usr/bin/hdiutil', ['attach', '-nobrowse', '-mountpoint', mount, image]); attached = true;
    const project = path.join(mount, 'project.json'); await writeFile(project, '{"complete":"previous"}');
    await assert.rejects(atomicReplace(project, file => writeFile(file, Buffer.alloc(40*1024**2,1), { flag: 'wx' })), { code: 'ENOSPC' });
    assert.equal(JSON.parse(await readFile(project,'utf8')).complete, 'previous');
    assert.equal((await readdir(mount)).filter(name=>name.endsWith('.tmp')).length,0);
    const source = await generateDemo(path.join(directory,'source.mp4')); const media = await inspectMedia(source);
    const space = await statfs(mount), filler = path.join(mount,'filler');
    await writeFile(filler, Buffer.alloc(Math.max(0, space.bavail*space.bsize-512*1024), 1));
    await assert.rejects(exportMedia(media, [], media.audioTracks[0].index, mount), error => error.code==='ENOSPC' || /No space left|ENOSPC/.test(error.message));
    assert.equal((await readdir(mount)).filter(name=>name.endsWith('.work') || name.endsWith('.mp4')).length,0);
    assert.equal((await inspectMedia(source)).fingerprint,media.fingerprint);
    await rm(filler);
    const output = await exportMedia(media, [], media.audioTracks[0].index, mount); assert.equal(output.verified,true);
    await atomicReplace(project,file=>writeFile(file,'{"complete":"retry"}',{flag:'wx'}));
    assert.equal(JSON.parse(await readFile(project,'utf8')).complete,'retry');
  } finally {
    if (attached) await exec('/usr/bin/hdiutil',['detach',mount]);
    await rm(directory,{recursive:true,force:true});
  }
});
