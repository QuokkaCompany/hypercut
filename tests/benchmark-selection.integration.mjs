import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { installSelectionProbe, measureSelections, selectionSnapshot } from '../scripts/helpers/selection-probe.mjs';

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture() {
  const page = await browser.newPage();
  await page.setContent('<div class="caption-progress">running</div><button class="caption-row" aria-label="자막 1 선택">one</button><button class="caption-row" aria-label="자막 2 선택">two</button>');
  await page.evaluate(() => { document.addEventListener('click', event => { const row = event.target.closest('button.caption-row'); if (row) { document.querySelectorAll('.caption-row').forEach(node => node.classList.remove('selected')); row.classList.add('selected'); } }); });
  await installSelectionProbe(page); return page;
}
test('selection timing records 32 planned actions and preserves four later clicks separately', async () => {
  const page = await fixture();
  try {
    const measured = await measureSelections(page); assert.equal(measured.length, 32);
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: `자막 ${i % 2 + 1} 선택`, exact: true }).click();
    const result = await selectionSnapshot(page);
    assert.deepEqual(result.samples, measured); assert.equal(result.outsideCount, 4); assert.equal(result.outside.length, 4);
    assert.ok(result.outside.every(event => event.action === null && event.trusted));
    assert.ok(result.samples.every(sample => sample.ms >= 0 && sample.running && sample.selected));
  } finally { await page.close(); }
});
test('an extra event inside the measurement window is rejected and retained as evidence', async () => {
  const page = await fixture();
  try {
    await page.evaluate(() => {
      let inserted = false;
      document.addEventListener('click', event => { const row = event.target.closest('button.caption-row'); if (row && event.isTrusted && !inserted) { inserted = true; row.click(); } });
    });
    await assert.rejects(measureSelections(page), /Expected exactly 32 measured selection events; got 33/);
    const result = await selectionSnapshot(page);
    assert.equal(result.samples.length, 33); assert.equal(result.outsideCount, 0);
    assert.equal(result.samples.filter(sample => !sample.trusted).length, 1);
  } finally { await page.close(); }
});
