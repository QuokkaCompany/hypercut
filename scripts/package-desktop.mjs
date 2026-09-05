import { packager } from '@electron/packager';
const excluded = [/^\/\.git($|\/)/, /^\/\.(codex|agents)($|\/)/, /^\/\.hypercut($|\/)/, /^\/\.playwright-mcp($|\/)/, /^\/\.env($|\.)/, /^\/release($|\/)/, /^\/tests($|\/)/, /^\/test-output($|\/)/, /^\/docs($|\/)/];
const paths = await packager({
  dir: '.', out: 'release', name: 'HyperCut', appBundleId: 'dev.hypercut.editor', appVersion: '0.1.0',
  platform: process.platform, arch: process.arch, overwrite: true, prune: true,
  asar: { unpackDir: 'node_modules/onnxruntime-node/bin' },
  ignore: candidate => {
    if (excluded.some(pattern => pattern.test(candidate))) return true;
    const binary = candidate.match(/^\/node_modules\/onnxruntime-node\/bin\/[^/]+\/([^/]+)(?:\/([^/]+))?/);
    return !!binary && (binary[1] !== process.platform || !!binary[2] && binary[2] !== process.arch);
  },
  darwinDarkModeSupport: true
});
console.log(paths.join('\n'));
