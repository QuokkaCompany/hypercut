import { chromium, _electron as electron } from 'playwright';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { startServer } from '../tests/reference/server/app.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { writeFlashVideo } from '../tests/helpers/effects-fixture.mjs';
import { DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { DEFAULT_CAPTION_STYLE } from '../shared/caption-style.mjs';
import { sha256 } from './helpers/transcription-performance-fixture.mjs';

const directory = await mkdtemp(path.join(os.tmpdir(), 'hypercut-caption-list-'));
await mkdir('test-output', { recursive: true });
const results = { date: new Date().toISOString(), status: 'running', scope: '1000 very short synthetic manual cues exercise list identity, keyboard selection, unapplied-draft protection, current timestamps, undo/redo and whole-project persistence. Not speech quality, caption readability or performance measurement.', sourceHashes: {}, runs: [] };
for (const file of ['src/WindowedList.tsx', 'src/Captions.tsx', 'src/CaptionList.tsx', 'scripts/caption-list-e2e.mjs', 'dist/index.html', 'release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar']) results.sourceHashes[file] = await sha256(file);
let server, browser, desktop;
try {
  const source = await writeFlashVideo(path.join(directory, 'caption-list.mp4')), media = await inspectMedia(source);
  const cues = Array.from({ length: 1000 }, (_, i) => ({ id: `cue-${i}`, start: Number((i * .007).toFixed(6)), end: Number((i * .007 + .006).toFixed(6)), text: `목록 검증 ${i + 1}` }));
  const initial = { format: 'hypercut-project', version: 7, media: { name: media.name, fingerprint: media.fingerprint, duration: media.duration }, settings: { ...DEFAULT_SETTINGS }, speechProtection: { enabled: false, threshold: .5 }, trackIndex: 1, cuts: [], transcript: { trackIndex: 1, channel: 0, language: 'ko', model: 'manual list fixture', cues }, captionStyle: { ...DEFAULT_CAPTION_STYLE }, effects: { assets: [], clips: [] }, glossary: '', savedAt: '2026-09-06T00:00:00.000Z' };
  const projectFile = path.join(directory, 'initial.json'); await writeFile(projectFile, JSON.stringify(initial));
  const content = ({ savedAt, ...rest }) => rest;
  async function exercise(page, surface) {
    const run = { surface, status: 'running' }, errors = [], external = []; results.runs.push(run);
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(request.url())) external.push(request.url()); });
    const button = name => page.locator(`button[aria-label="${name}"]`);
    async function caption(number) { const row = page.locator('.caption-row').first(); await row.focus(); await row.press(number === 1 ? 'Home' : 'End'); const target = button(`자막 ${number} 선택`); await target.waitFor(); return target; }
    await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled);
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source); await button('영상 추가').click(); }
    else await page.locator('input[type=file]').first().setInputFiles(source);
    await page.waitForFunction(() => document.querySelector('video')?.readyState >= 2 && !document.querySelector('.job-overlay'));
    await page.locator('input[type=file]').nth(1).setInputFiles(projectFile);
    await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
    await button('전사와 자막').click(); assert.equal(Number(await page.locator('.caption-list').getAttribute('data-item-count')), 1000);
    const text = page.locator('textarea[aria-label="자막 문구"]'), last = cues.at(-1);
    await (await caption(1000)).focus(); await (await caption(1000)).press('Enter');
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, last.text);
    assert.equal(await page.locator('.caption-row.selected').getAttribute('aria-label'), '자막 1000 선택');
    await text.fill('아직 적용하지 않은 문구'); page.once('dialog', dialog => void dialog.dismiss()); await (await caption(1)).click();
    assert.equal(await text.inputValue(), '아직 적용하지 않은 문구'); assert.equal(await page.locator('.caption-row.selected').getAttribute('aria-label'), '자막 1000 선택');
    page.once('dialog', dialog => void dialog.accept()); await (await caption(1)).click();
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, cues[0].text);
    await (await caption(1000)).focus(); await (await caption(1000)).press('Space');
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, last.text);
    const changed = { ...last, start: Number((last.start + .001).toFixed(6)), text: `${last.text} 수정` };
    await text.fill(changed.text); await page.locator('input[aria-label="자막 시작"]').fill(String(changed.start)); await page.locator('.caption-fields button[type=submit]').click();
    await page.waitForFunction(expected => document.querySelector('.caption-row.selected p')?.textContent === expected, changed.text);
    await button('자막 실행 취소').click(); await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, last.text);
    assert.equal(Number(await page.locator('input[aria-label="자막 시작"]').inputValue()), last.start);
    await button('자막 다시 실행').click(); await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, changed.text);
    await (await caption(1)).click(); await (await caption(1000)).click();
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, changed.text);
    assert.equal(Number(await page.locator('input[aria-label="자막 시작"]').inputValue()), changed.start);
    await page.waitForFunction(expected => Math.abs(document.querySelector('video[aria-label="자막 원본 청취"]')?.currentTime - expected) < .0001, changed.start);
    assert.equal(Number(await page.locator('.caption-list').getAttribute('data-item-count')), 1000);
    // A selected value alone does not prove that newly visible neighbouring rows
    // are painted after a long scroll, or that the source video finished seeking.
    const visibleRowsStarted = performance.now();
    await page.waitForFunction(() => {
      const list = document.querySelector('.caption-list'), clip = list.getBoundingClientRect();
      const rows = [...list.querySelectorAll('.caption-row')].filter(row => { const rect = row.getBoundingClientRect(); return rect.bottom > clip.top && rect.top < clip.bottom; });
      return rows.length >= 2 && rows.every(row => row.querySelector('p').checkVisibility({ contentVisibilityAuto: true }));
    });
    run.neighbourVisibilityWaitMs = performance.now() - visibleRowsStarted;
    await page.waitForFunction(() => { const video = document.querySelector('video[aria-label="자막 원본 청취"]'); return video.readyState >= 2 && !video.seeking; });
    run.visibleNeighboursRendered = true; run.sourceSeekSettled = true;
    await page.locator('.caption-design-preview[aria-busy=false] img').waitFor();
    await page.locator('.caption-design-preview img').evaluate(img => img.decode());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.screenshot({ path: `test-output/caption-list-${surface}.png` });
    await button('자막 창 닫기').click();
    const saved = path.join(directory, `${surface}.json`);
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved); await button('프로젝트 저장').first().click(); await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor(); }
    else { const download = page.waitForEvent('download'); await button('프로젝트 저장').first().click(); await (await download).saveAs(saved); }
    const stored = JSON.parse(await readFile(saved, 'utf8'));
    const expected = { ...initial, transcript: { ...initial.transcript, cues: [...cues.slice(0, -1), changed] } }; assert.deepEqual(content(stored), content(expected));
    await page.locator('input[type=file]').nth(1).setInputFiles(saved); await button('전사와 자막').click(); await (await caption(1000)).click();
    await page.waitForFunction(expected => document.querySelector('textarea[aria-label="자막 문구"]')?.value === expected, changed.text);
    assert.equal(Number(await page.locator('input[aria-label="자막 시작"]').inputValue()), changed.start);
    await button('자막 창 닫기').click(); assert.deepEqual(errors, []); assert.deepEqual(external, []);
    Object.assign(run, { status: 'PASS', allThousandCuesRetained: true, nativeEdgeNavigation: true, enterAndSpaceSelection: true, rejectedDraftDiscardPreserved: true, acceptedDraftDiscardApplied: true, editUndoRedo: true, currentTextAndSeek: true, fullProjectRoundTrip: true, pageErrors: errors, externalRequests: external.length });
  }
  server = await startServer({ port: 0, dataDir: path.join(directory, 'browser') }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await exercise(page, 'browser'); await browser.close(); browser = null; await server.close(); server = null;
  desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [`--user-data-dir=${path.join(directory, 'profile')}`], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(directory, 'desktop') } });
  await exercise(await desktop.firstWindow(), 'desktop'); results.status = 'completed';
} catch (error) {
  results.status = 'failed'; results.error = error.stack; process.exitCode = 1;
  const page = desktop ? await desktop.firstWindow().catch(() => null) : browser?.contexts()[0]?.pages()[0];
  results.failureUI = await page?.evaluate(() => ({ selected: document.querySelector('.caption-row.selected')?.textContent, invalidFields: [...document.querySelectorAll('input:invalid')].map(input => ({ label: input.getAttribute('aria-label'), value: input.value, message: input.validationMessage })) })).catch(() => null);
}
finally { await desktop?.close(); await browser?.close(); await server?.close(); await rm(directory, { recursive: true, force: true }); await writeFile('test-output/caption-list-e2e.json', JSON.stringify(results, null, 2) + '\n'); }
console.log(JSON.stringify(results));
