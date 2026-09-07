import { packager } from '@electron/packager';
import { mkdir, cp, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
const backend = path.resolve('.cache/backend');
await rm(backend, { recursive: true, force: true });
await mkdir(backend, { recursive: true });
await copyFile('.cache/bin/hypercut-cloud', path.join(backend, 'hypercut'));
for (const [from, to] of [['assets', 'assets'], ['dist', 'dist'], ['.cache/native', 'native'], [process.env.HYPERCUT_TRANSCRIPTION_DIR || '.hypercut/transcription', 'transcription']]) {
  await cp(from, path.join(backend, to), { recursive: true, force: true });
}
const paths = await packager({
  dir: '.', out: 'release', name: 'HyperCut', appBundleId: 'dev.hypercut.editor', appVersion: '0.1.0',
  platform: process.platform, arch: process.arch, overwrite: true, prune: false,
  extraResource: [backend], asar: true,
  // Only the Electron presentation adapter is JavaScript. The backend is Go.
  ignore: candidate => candidate !== '' && !/^\/(desktop(?:\/|$)|package\.json$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/.test(candidate),
  darwinDarkModeSupport: true,
});
console.log(paths.join('\n'));
