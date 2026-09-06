import assert from 'node:assert/strict';

export async function installSelectionProbe(page) {
  await page.evaluate(() => {
    window.__selectionProbe = { active: false, action: null, pending: 0, samples: [], outside: [], outsideCount: 0 };
    document.addEventListener('click', event => {
      const row = event.target.closest?.('button.caption-row'); if (!row) return;
      const state = window.__selectionProbe, at = performance.now();
      const detail = { action: state.action, label: row.getAttribute('aria-label'), at, trusted: event.isTrusted, clickCount: event.detail };
      if (!state.active) { state.outsideCount++; if (state.outside.length < 256) state.outside.push(detail); return; }
      state.pending++;
      requestAnimationFrame(() => { state.samples.push({ ...detail, ms: performance.now() - at, selected: row.classList.contains('selected'), running: !!document.querySelector('.caption-progress') }); state.pending--; });
    }, true);
  });
}

export function validateSelectionSamples(samples, count = 32) {
  assert.equal(samples.length, count, `Expected exactly ${count} measured selection events; got ${samples.length}`);
  samples.forEach((sample, index) => {
    assert.equal(sample.action, index, 'Every planned click must contribute exactly one sample in order.');
    assert.equal(sample.label, `자막 ${index % 2 ? 1 : 2} 선택`);
    assert.equal(sample.trusted, true); assert.equal(sample.selected, true); assert.equal(sample.running, true);
    assert.ok(Number.isFinite(sample.ms) && sample.ms >= 0);
  });
  return samples;
}

export async function measureSelections(page, count = 32) {
  await page.evaluate(() => Object.assign(window.__selectionProbe, { active: true, action: null, pending: 0, samples: [], outside: [], outsideCount: 0 }));
  try {
    for (let action = 0; action < count; action++) {
      await page.evaluate(value => { window.__selectionProbe.action = value; }, action);
      await page.getByRole('button', { name: `자막 ${action % 2 ? 1 : 2} 선택`, exact: true }).click();
    }
    await page.waitForFunction(() => window.__selectionProbe.pending === 0);
  } finally {
    await page.evaluate(() => { window.__selectionProbe.active = false; window.__selectionProbe.action = null; });
  }
  return validateSelectionSamples((await selectionSnapshot(page)).samples, count);
}

export function selectionSnapshot(page) {
  return page.evaluate(() => { const value = window.__selectionProbe; return { samples: value.samples, outsideCount: value.outsideCount, outside: value.outside }; });
}
