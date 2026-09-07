import { _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import assert from 'node:assert/strict';
import { generateDemo } from './fixtures.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { capture } from '../tests/reference/server/process.mjs';
import { makeProject, validateProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';

const output = path.resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-output/native-save-dialog');
assert.ok(output.startsWith(path.resolve('test-output') + path.sep));
const files = path.join(output, 'files'), reportPath = path.join(output, 'results.json');
await mkdir(files, { recursive: true });
if (await readFile(reportPath).then(() => true).catch(error => { if (error.code === 'ENOENT') return false; throw error; })) throw new Error('Results exist; use a new --output.');
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const source = await generateDemo(path.join(files, 'source.mp4')), media = await inspectMedia(source);
const projectFile = path.join(files, 'existing.hypercut.json'), videoFile = path.join(files, 'existing.mp4');
await writeFile(projectFile, JSON.stringify(makeProject(media, { ...DEFAULT_SETTINGS, thresholdDb: -55 }, media.audioTracks[0].index, [], undefined, null, undefined, undefined, '이전 저장본')));
await capture('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=320x180:rate=30:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '4', '-y', videoFile]);
const report = { date: new Date().toISOString(), code: (await promisify(execFile)('git', ['rev-parse', 'HEAD'])).stdout.trim(), packageSHA256: await hash('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar'), scope: 'Real packaged Mac save dialogs and OS overwrite prompts; generated files only. Native save-dialog function/results are not mocked.', status: 'running', sourceSHA256: await hash(source), projectBeforeSHA256: await hash(projectFile), videoBeforeSHA256: await hash(videoFile), checks: [], pageErrors: [], externalRequests: [] };
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await flush();
let desktop, page, originalSaveFunction, expectedExportSHA256, phase = 'initializing';
const button = name => page.getByRole('button', { name, exact: true });
const savedProjectNotice = '프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.';
const savedExportNotice = '편집한 영상을 저장했습니다.';
async function dismissNotices() { const close = button('알림 닫기'); if (await close.count()) await close.click(); }
async function unchangedSource() { assert.equal(await hash(source), report.sourceSHA256); }
async function state() { return { phase, pid: desktop.process().pid, files, projectFile, videoFile, source, dirty: await page.locator('.unsaved-dot').count(), savingDisabled: await button('프로젝트 저장').first().isDisabled(), alerts: await page.locator('.notice-toast,.error-toast').allTextContents() }; }
async function record(id, details) { await unchangedSource(); report.checks.push({ id, status: 'PASS', ...details, sourceUnchanged: true }); await flush(); }

try {
  desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), cwd: files, args: [`--user-data-dir=${path.join(output, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(output, 'media') } });
  page = await desktop.firstWindow();
  page.on('pageerror', error => report.pageErrors.push(error.message));
  page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) report.externalRequests.push(request.url()); });
  page.on('dialog', () => {});
  originalSaveFunction = await desktop.evaluate(({ dialog }) => dialog.showSaveDialog.toString());
  await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
  await desktop.evaluate(({ dialog }, file) => { globalThis.originalOpenDialog = dialog.showOpenDialog; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source);
  await button('영상 추가').click(); await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2);
  await desktop.evaluate(({ dialog }) => { dialog.showOpenDialog = globalThis.originalOpenDialog; delete globalThis.originalOpenDialog; });
  await page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).fill('-41');
  await page.locator('.analyze-button').click(); await button('무음 1 복원').waitFor();
  assert.equal(await page.locator('.cut-row').count(), 5);
  await dismissNotices();
  await desktop.evaluate(({ app, BrowserWindow }) => { app.focus({ steal: true }); BrowserWindow.getAllWindows()[0].focus(); });
  phase = 'ready'; console.log(JSON.stringify({ event: 'READY', ...await state() }));
  const commands = createInterface({ input: process.stdin, terminal: false });
  for await (const line of commands) {
    if (!line.trim()) continue;
    try {
      const command = JSON.parse(line).command;
      if (command === 'state') console.log(JSON.stringify(await state()));
      else if (command === 'begin-project') {
        assert.ok(['ready', 'project-cancelled'].includes(phase)); await dismissNotices();
        await button('프로젝트 저장').first().click(); phase = 'project-dialog'; console.log(JSON.stringify(await state()));
      } else if (command === 'check-project-cancelled') {
        await page.waitForFunction(() => !document.querySelector('button[aria-label="프로젝트 저장"]')?.disabled);
        assert.equal(await hash(projectFile), report.projectBeforeSHA256);
        assert.equal(await page.locator('.unsaved-dot').count(), 1); assert.equal(await page.getByText(savedProjectNotice, { exact: true }).count(), 0);
        await record('project-cancel', { existingFileUnchanged: true, dirtyPreserved: true, noFalseSuccess: true });
        phase = 'project-cancelled'; console.log(JSON.stringify(await state()));
      } else if (command === 'check-project-replaced') {
        await page.getByText(savedProjectNotice, { exact: true }).waitFor();
        const project = validateProject(JSON.parse(await readFile(projectFile, 'utf8')));
        assert.notEqual(await hash(projectFile), report.projectBeforeSHA256); assert.equal(project.version, 8); assert.equal(project.settings.thresholdDb, -41); assert.equal(project.media.fingerprint, media.fingerprint); assert.equal(project.cuts.length, 5); assert.equal(project.glossary, '');
        assert.equal(await page.locator('.unsaved-dot').count(), 0);
        await record('project-replace', { currentProjectSaved: true, savedSHA256: await hash(projectFile), projectVersion: project.version });
        phase = 'project-replaced'; console.log(JSON.stringify(await state()));
      } else if (command === 'prepare-export') {
        assert.equal(phase, 'project-replaced'); await dismissNotices();
        let outputResult;
        const observe = async response => { if (/\/api\/jobs\/[0-9a-f-]+$/.test(response.url())) { const value = await response.json().catch(() => null); if (value?.type === 'export' && value.status === 'completed') outputResult = value.result; } };
        page.on('response', observe); await button('내보내기').click(); await button('편집한 MP4 저장').waitFor({ timeout: 60000 }); page.off('response', observe);
        assert.ok(outputResult?.id);
        const config = await (await page.request.get(new URL('/api/config', page.url()).href)).json();
        const downloaded = await page.request.get(new URL(`/api/exports/${outputResult.id}?token=${encodeURIComponent(config.token)}`, page.url()).href);
        assert.equal(downloaded.status(), 200); expectedExportSHA256 = createHash('sha256').update(await downloaded.body()).digest('hex');
        report.expectedExportSHA256 = expectedExportSHA256; report.expectedExportDuration = outputResult.duration; await flush();
        phase = 'export-ready'; console.log(JSON.stringify(await state()));
      } else if (command === 'begin-export') {
        assert.ok(['export-ready', 'export-cancelled', 'export-replaced'].includes(phase)); await dismissNotices();
        await button('편집한 MP4 저장').click(); phase = 'export-dialog'; console.log(JSON.stringify(await state()));
      } else if (command === 'check-export-cancelled') {
        assert.equal(await hash(videoFile), report.videoBeforeSHA256); assert.equal(await page.getByText(savedExportNotice, { exact: true }).count(), 0); assert.equal(await button('편집한 MP4 저장').isEnabled(), true);
        await record('export-cancel', { existingFileUnchanged: true, noFalseSuccess: true }); phase = 'export-cancelled'; console.log(JSON.stringify(await state()));
      } else if (command === 'check-export-replaced') {
        await page.getByText(savedExportNotice, { exact: true }).waitFor();
        assert.equal(await hash(videoFile), expectedExportSHA256); assert.notEqual(expectedExportSHA256, report.videoBeforeSHA256);
        const result = await inspectMedia(videoFile); assert.ok(Math.abs(result.duration - report.expectedExportDuration) < .1);
        await capture('ffmpeg', ['-v', 'error', '-i', videoFile, '-f', 'null', '-']);
        await record('export-replace', { exactRenderedBytesSaved: true, fullDecode: true, savedSHA256: expectedExportSHA256, duration: result.duration }); phase = 'export-replaced'; console.log(JSON.stringify(await state()));
      } else if (command === 'check-original-protected') {
        await page.locator('.error-toast').filter({ hasText: '원본 영상과 다른 이름으로 저장해 주세요.' }).waitFor();
        await record('source-protection', { nativeReplacementApprovedButSourceRejected: true });
        await button('오류 닫기').click(); phase = 'verified'; console.log(JSON.stringify(await state()));
      } else if (command === 'finish') {
        assert.equal(phase, 'verified'); assert.equal(report.checks.length, 5);
        assert.equal(await desktop.evaluate(({ dialog }) => dialog.showSaveDialog.toString()), originalSaveFunction);
        assert.deepEqual(report.pageErrors, []); assert.deepEqual(report.externalRequests, []);
        report.nativeSaveFunctionUnmodified = true; report.status = 'completed'; await flush();
        commands.close(); break;
      } else throw new Error('Unknown command.');
    } catch (error) { report.lastCommandError = error.message; await flush(); console.log(JSON.stringify({ event: 'COMMAND_ERROR', phase, message: error.message })); }
  }
} catch (error) { report.status = 'failed'; report.error = error.stack; throw error; }
finally {
  if (report.status === 'running') { report.status = 'failed'; report.error = 'Session ended before all native dialog checks completed.'; }
  if (desktop) { if (report.status !== 'completed') desktop.process().kill('SIGKILL'); else await desktop.close(); }
  await flush();
}
console.log(JSON.stringify({ status: report.status, reportPath }));
