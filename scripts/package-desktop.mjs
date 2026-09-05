import { packager } from '@electron/packager';
const paths = await packager({
  dir: '.', out: 'release', name: 'HyperCut', appBundleId: 'dev.hypercut.editor', appVersion: '0.1.0',
  platform: process.platform, arch: process.arch, overwrite: true, prune: true,
  ignore: [/^\/\.git($|\/)/, /^\/\.(codex|agents)($|\/)/, /^\/\.hypercut($|\/)/, /^\/\.playwright-mcp($|\/)/, /^\/\.env($|\.)/, /^\/release($|\/)/, /^\/tests($|\/)/, /^\/test-output($|\/)/, /^\/docs($|\/)/],
  darwinDarkModeSupport: true
});
console.log(paths.join('\n'));
