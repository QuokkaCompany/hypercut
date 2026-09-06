import { packager } from '@electron/packager';
import { transcriptionStatus, transcriptionRuntime } from '../server/transcription.mjs';
if (!(await transcriptionStatus()).ready) throw new Error('패키징 전에 npm run setup:transcription으로 로컬 전사를 준비해 주세요.');
const excluded = [/^\/\.git($|\/)/, /^\/\.(codex|agents|claude|github|vscode|idea)($|\/)/, /^\/\.hypercut($|\/)/, /^\/\.playwright-mcp($|\/)/, /^\/\.env($|\.)/, /^\/release($|\/)/, /^\/tests($|\/)/, /^\/test-output($|\/)/, /^\/docs($|\/)/, /^\/(reports|exports|media|coverage|playwright-report|test-results)($|\/)/];
const paths = await packager({
  dir: '.', out: 'release', name: 'HyperCut', appBundleId: 'dev.hypercut.editor', appVersion: '0.1.0',
  platform: process.platform, arch: process.arch, overwrite: true, prune: true,
  extraResource: [transcriptionRuntime()],
  asar: { unpack: '**/*.node', unpackDir: 'node_modules/onnxruntime-node/bin' },
  ignore: candidate => {
    if (excluded.some(pattern => pattern.test(candidate))) return true;
    const binary = candidate.match(/^\/node_modules\/onnxruntime-node\/bin\/[^/]+\/([^/]+)(?:\/([^/]+))?/);
    return !!binary && (binary[1] !== process.platform || !!binary[2] && binary[2] !== process.arch);
  },
  darwinDarkModeSupport: true
});
console.log(paths.join('\n'));
