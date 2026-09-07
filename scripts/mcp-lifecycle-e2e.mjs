import { chromium, _electron as electron } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import assert from 'node:assert/strict';
import { extractFile } from '@electron/asar';
import { startServer } from '../tests/reference/server/app.mjs';
import { inspectMedia } from '../tests/reference/server/media.mjs';
import { makeProject, DEFAULT_SETTINGS } from '../shared/timeline.mjs';
import { writeFlashVideo } from '../tests/helpers/effects-fixture.mjs';

const output = path.resolve(process.argv.find(x => x.startsWith('--output='))?.slice(9) || `test-output/mcp-lifecycle-${Date.now()}`);
await mkdir(output);
const report = { status: 'running', date: new Date().toISOString(), scope: 'Actual Chrome and packaged Mac UI with real app HTTP state and controlled response delivery. Synthetic media; not a new stdio/account/model/tunnel test. Native dialog selections controlled by test.', sourceHashes: {}, cases: [], barriers: [] };
for (const f of ['src/MCPShare.tsx', 'src/AIAssistant.tsx', 'server/app.mjs', 'server/mcp-shares.mjs', 'server/mcp-routes.mjs', 'scripts/mcp-lifecycle-e2e.mjs', 'package-lock.json', 'release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar']) report.sourceHashes[f] = createHash('sha256').update(await readFile(f)).digest('hex');
const bundles = [...(await readFile('dist/index.html', 'utf8')).matchAll(/"(\/assets\/[^\"]+)"/g)].map(match => `dist${match[1]}`);
assert.ok(bundles.some(file => file.endsWith('.js')));
report.packageSourceHashes = {};
for (const f of ['src/MCPShare.tsx', 'src/AIAssistant.tsx', 'src/App.tsx', 'server/app.mjs', 'server/mcp-shares.mjs', 'server/mcp-routes.mjs', 'server/media.mjs', 'shared/timeline.mjs', 'dist/index.html', ...bundles]) {
  report.sourceHashes[f] = createHash('sha256').update(await readFile(f)).digest('hex');
  report.packageSourceHashes[f] = createHash('sha256').update(extractFile('release/HyperCut-darwin-arm64/HyperCut.app/Contents/Resources/app.asar', f)).digest('hex');
  assert.equal(report.packageSourceHashes[f], report.sourceHashes[f], `Stale package: ${f}`);
}
await writeFile(path.join(output, 'executed-runner.mjs'), await readFile(import.meta.filename));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const button = (p, name) => p.getByRole('button', { name, exact: true });
const paints = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
let browser, desktop, server; const cleanup = [];
try {
  const sources = [];
  for (const [name, channels, thresholdDb] of [['first', 1, -40], ['second', 2, -52]]) {
    const file = await writeFlashVideo(path.join(output, `${name}.mp4`), { channels }), media = await inspectMedia(file);
    const project = makeProject(media, { ...DEFAULT_SETTINGS, thresholdDb }, 1, [{ id: `${name}-cut`, start: 2, end: 4, enabled: true, reason: 'silence' }]);
    const projectFile = path.join(output, `${name}.json`); await writeFile(projectFile, JSON.stringify(project)); sources.push({ file, media, project, projectFile });
  }
  assert.notEqual(sources[0].media.fingerprint, sources[1].media.fingerprint);
  async function exercise(page, surface) {
    const errors = [], external = []; page.on('pageerror', e => errors.push(e.message)); page.on('request', r => { if (!/^(http:\/\/127\.0\.0\.1:|blob:|data:)/.test(r.url())) external.push(r.url()); }); page.on('dialog', d => d.accept());
    let source = sources[0], panel;
    const base = new URL(page.url()).origin;
    const exchange = async share => page.request.get(`${base}/api/mcp-exchange/${share.shareId}`, { headers: { 'X-Hypercut-Share-Capability': share.capability } });
    const submit = async share => {
      const proposalId = randomUUID(), proposal = { settings: { ...source.project.settings, minSilenceMs: 1300 }, explanation: '이전 요청의 제안' };
      const r = await page.request.post(`${base}/api/mcp-exchange/${share.shareId}/proposals`, { headers: { 'X-Hypercut-Share-Capability': share.capability }, data: { contextVersion: share.contextVersion, proposalId, proposal } }); assert.equal(r.status(), 200); return proposalId;
    };
    async function openSource(next) {
      source = next;
      if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, source.file); await button(page, '영상 추가').click(); }
      else await page.locator('input[type=file]').first().setInputFiles(source.file);
      await page.waitForFunction(name => document.querySelector('.project-title')?.textContent.includes(name) && document.querySelector('video')?.readyState >= 2 && !document.querySelector('.project-open')?.disabled, path.basename(source.file, '.mp4'));
      await page.locator('input[type=file]').nth(1).setInputFiles(source.projectFile);
      await page.waitForFunction(value => document.querySelector('[aria-label="음량 임계값"]')?.value === String(value), source.project.settings.thresholdDb);
      await page.getByText('프로젝트의 편집 구간을 복원했습니다. 파형이 필요하면 다시 분석할 수 있습니다.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).inputValue(), String(source.project.settings.thresholdDb));
    }
    async function openAI() { await button(page, 'AI 편집 도우미').click(); panel = page.getByRole('dialog', { name: 'AI 편집 도우미', exact: true }); await panel.getByLabel('사용할 AI', { exact: true }).selectOption('mcp'); }
    const instruction = text => panel.locator('label.ai-field').filter({ hasText: '어떻게 편집할까요?' }).locator('textarea').fill(text);
    async function config() {
      await panel.getByText('MCP 연결 설정 보기', { exact: true }).click(); const c = JSON.parse(await panel.getByRole('textbox', { name: 'MCP 연결 설정', exact: true }).inputValue()).mcpServers.hypercut;
      await panel.getByText('MCP 연결 설정 보기', { exact: true }).click();
      return { shareId: c.env.HYPERCUT_MCP_SHARE, capability: c.env.HYPERCUT_MCP_CAPABILITY };
    }
    async function create() { await button(panel, 'MCP로 이 요청 공유').click(); const c = await config(), r = await exchange(c); assert.equal(r.status(), 200); return { ...c, ...(await r.json()) }; }
    async function unchanged() { assert.equal(await page.getByRole('spinbutton', { name: '음량 임계값', exact: true }).inputValue(), String(source.project.settings.thresholdDb)); assert.equal(await page.getByRole('spinbutton', { name: '최소 무음 길이', exact: true }).inputValue(), String(source.project.settings.minSilenceMs / 1000)); }
    async function unavailable(share) { for (let i = 0; i < 100; i++) { const r = await exchange(share); if (r.status() === 404) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Obsolete share was not revoked'); }
    async function barrier(name, url, method, { all = false } = {}) {
      const seen = deferred(), gate = deferred(), done = [], entry = { surface, name, responses: [], released: false };
      report.barriers.push(entry); let matched = false;
      const handler = async route => {
        if (route.request().method() !== method || matched && !all) { await route.continue(); return; }
        matched = true; const completion = deferred(); done.push(completion.promise);
        const started = performance.now(), response = await route.fetch(), body = await response.json();
        const observation = { status: response.status(), bodyReceivedMs: performance.now() - started, heldMs: null, delivered: false }; entry.responses.push(observation);
        seen.resolve(body); const held = performance.now(); await gate.promise; observation.heldMs = performance.now() - held;
        try { await route.fulfill({ response }); observation.delivered = true; } finally { completion.resolve(); }
      };
      await page.route(url, handler);
      let released = false;
      const release = async () => { if (released) return; released = true; entry.released = true; gate.resolve(); await Promise.allSettled(done); await page.unroute(url, handler); await paints(page); };
      cleanup.push(release); return { seen: seen.promise, release, entry };
    }
    const record = name => { report.cases.push({ surface, name, status: 'PASS' }); console.log(JSON.stringify(report.cases.at(-1))); };
    await openSource(source); await openAI();
    // L01: creation has happened on the server, but its response is still old.
    let held = await barrier('L01-create', '**/api/ai/shares', 'POST'); await button(panel, 'MCP로 이 요청 공유').click(); const old = await held.seen;
    await instruction('새로운 요청 B'); let fresh = await create(); await held.release(); await unavailable(old);
    assert.equal((await (await exchange(fresh)).json()).context.request.instruction, '새로운 요청 B'); assert.equal((await config()).shareId, fresh.shareId); await unchanged(); record('L01-late-creation');
    await button(panel, 'AI 창 닫기').click(); await unavailable(fresh); await openAI();
    // L02: the component is gone and a different real media/project is current.
    held = await barrier('L02-create', '**/api/ai/shares', 'POST'); await button(panel, 'MCP로 이 요청 공유').click(); const oldProjectShare = await held.seen;
    await button(panel, 'AI 창 닫기').click(); await openSource(sources[1]); await openAI(); fresh = await create(); await held.release(); await unavailable(oldProjectShare);
    assert.equal((await config()).shareId, fresh.shareId); assert.deepEqual((await (await exchange(fresh)).json()).context.request.settings, source.project.settings); await unchanged(); record('L02-new-project');
    await button(panel, 'AI 창 닫기').click(); await unavailable(fresh); await openAI();
    // L03: a real proposal was read before revocation, but must not reappear.
    const proposed = await create(); held = await barrier('L03-poll', `**/api/ai/shares/${proposed.shareId}`, 'GET', { all: true }); await submit(proposed); const polled = await held.seen; assert.equal(polled.status, 'proposed');
    await instruction('새로운 요청 C'); fresh = await create(); await held.release(); await unavailable(proposed);
    assert.equal(await button(panel, '설정 적용').count(), 0); assert.equal(await panel.getByText('이전 요청의 제안', { exact: true }).count(), 0); assert.equal((await config()).shareId, fresh.shareId); await unchanged(); record('L03-late-proposal');
    await button(panel, 'AI 창 닫기').click(); await unavailable(fresh); await openAI();
    // L04: old apply validation must not clear a new creation's loading state.
    const applying = await create(); await submit(applying); await button(panel, '설정 적용').waitFor();
    held = await barrier('L04-apply-check', `**/api/ai/shares/${applying.shareId}`, 'GET', { all: true }); await button(panel, '설정 적용').click(); await held.seen;
    await instruction('새로운 요청 D'); const newCreation = await barrier('L04-new-create', '**/api/ai/shares', 'POST'); await button(panel, 'MCP로 이 요청 공유').click(); const next = await newCreation.seen;
    await held.release();
    assert.equal(await panel.getByRole('alert').count(), 0, 'Old apply validation must not put an error on the new share');
    assert.equal(await button(panel, '공유 준비 중…').isDisabled(), true, 'New creation remains busy until its own response');
    await newCreation.release(); fresh = await config(); assert.equal(fresh.shareId, next.shareId); await unavailable(applying); await unchanged(); record('L04-late-apply-check');
    await button(panel, 'AI 창 닫기').click(); await unavailable(fresh); await openAI();
    // L06: a failure for the current request must remain visible and retryable.
    const current = await create(); await submit(current); await button(panel, '설정 적용').waitFor();
    const currentURL = `**/api/ai/shares/${current.shareId}`; let failedChecks = 0;
    const failCurrent = async route => {
      if (route.request().method() !== 'GET' || failedChecks) { await route.continue(); return; }
      failedChecks++; const response = await route.fetch(); assert.equal(response.status(), 200);
      await route.fulfill({ response, status: 503, json: { error: '현재 공유 상태 확인 실패' } });
    };
    await page.route(currentURL, failCurrent); await button(panel, '설정 적용').click();
    await panel.getByRole('alert').filter({ hasText: '현재 공유 상태 확인 실패' }).waitFor();
    assert.equal(await button(panel, '설정 적용').isEnabled(), true); assert.equal((await config()).shareId, current.shareId); await unchanged();
    await page.unroute(currentURL, failCurrent); await button(panel, '제안을 적용하지 않기').click(); await panel.waitFor({ state: 'hidden' });
    const rejected = await (await exchange(current)).json(); assert.equal(rejected.status, 'rejected'); assert.equal(rejected.context, null); assert.equal(failedChecks, 1); await unchanged(); record('L06-current-failure-retry'); await openAI();
    // L05: provider change is reachable while the MCP component is waiting.
    held = await barrier('L05-create', '**/api/ai/shares', 'POST'); await button(panel, 'MCP로 이 요청 공유').click(); const switched = await held.seen;
    await panel.getByLabel('사용할 AI', { exact: true }).selectOption('manual'); await held.release(); await unavailable(switched);
    assert.equal(await panel.getByLabel('사용할 AI', { exact: true }).inputValue(), 'manual'); assert.equal(await panel.getByText('MCP 연결 설정 보기', { exact: true }).count(), 0); await unchanged(); record('L05-provider-change');
    await button(panel, 'AI 창 닫기').click();
    const saved = path.join(output, `${surface}-saved.json`);
    if (surface === 'desktop') { await desktop.evaluate(({ dialog }, file) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: file }); }, saved); await button(page, '프로젝트 저장').first().click(); await page.getByText('프로젝트를 저장했습니다. 영상 원본도 함께 보관해 주세요.', { exact: true }).waitFor(); }
    else { const download = page.waitForEvent('download'); await button(page, '프로젝트 저장').first().click(); await (await download).saveAs(saved); }
    const stored = JSON.parse(await readFile(saved, 'utf8')); assert.deepEqual(stored, { ...source.project, savedAt: stored.savedAt });
    assert.deepEqual(errors, []); assert.deepEqual(external, []);
    for (const entry of report.barriers.filter(e => e.surface === surface)) { assert.equal(entry.released, true); assert.ok(entry.responses.length); for (const r of entry.responses) { assert.equal(r.delivered, true); if (entry.name.includes('create')) assert.ok(r.heldMs < 4500, 'Creation race must finish before the app timeout'); } }
  }
  server = await startServer({ port: 0, dataDir: path.join(output, 'web') }); browser = await chromium.launch({ channel: 'chrome', headless: true });
  let page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); await page.goto(server.url); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await exercise(page, 'browser'); await browser.close(); browser = null;
  if (process.argv.includes('--desktop')) { desktop = await electron.launch({ executablePath: path.resolve('release/HyperCut-darwin-arm64/HyperCut.app/Contents/MacOS/HyperCut'), args: [], env: { ...process.env, HYPERCUT_DATA_DIR: path.join(output, 'desktop') } }); page = await desktop.firstWindow(); await page.waitForFunction(() => !document.querySelector('.import-button')?.disabled); await exercise(page, 'desktop'); }
  report.status = 'completed';
} catch (error) { report.status = 'failed'; report.error = error.stack; console.error(error); process.exitCode = 1; }
finally { await Promise.allSettled(cleanup.map(fn => fn())); await desktop?.close(); await browser?.close(); await server?.close(); await writeFile(path.join(output, 'results.json'), JSON.stringify(report, null, 2)); }
console.log(JSON.stringify({ status: report.status, output }));
