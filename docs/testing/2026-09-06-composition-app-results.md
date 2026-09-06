# Composition in the browser and native app

2026-09-06, after the integer frame-boundary fix. Both apps passed 60-second controls. Long browser candidates still failed memory and/or caption-response targets; full long-form acceptance was incomplete.

The actual UI imported and analyzed 16 cuts, opened 16 manual Korean captions and 16 effects plus muted/deleted controls, reconnected the asset, and saved the complete project, SRT, and MP4. Independent decoding checked every frame, caption presence/timing, effect gain/onset/end/leakage, and A/V markers. This fixture uses no AI or speech recognition. Each run performs 32 caption, 32 effect, and 32 cut actions, checking state, invalidation, and undo. Cancellation after the first export must preserve the existing output, file, and project before a second export succeeds.

## Initial short controls

| App / run | Analysis (s) | Export (s) | RSS (GiB) | Highest action p95 (ms) |
| --- | --- | --- | --- | --- |
| Chrome / 1 | 1.065 | 3.797 | 1.881 | 100.416 |
| Chrome / 2 | 0.867 | 3.815 | 1.950 | 100.201 |
| Mac / 1 | 1.272 | 3.677 | 1.287 | 60.867 |
| Mac / 2 | 1.117 | 3.768 | 1.376 | 59.680 |

All outputs matched: 1,448 frames, 16 captions/effects, six markers, complete projects, MP4/SRT bytes, and source hashes. Sample PNGs matched previously viewed engine frames. There were 384 actions; each p95 uses 32 samples, not two run durations. The independent oracle took approximately 3.03–3.07 seconds separately. App validation remained inside export timing and RSS. All app children were included, with driver/oracle processes excluded; maximum sample interval was 278.104 ms. No forced GC, restart, or cache purge occurred between repetitions.

Chrome cancellation at caption-preparation progress 0.3375 became visible in 0.800 ms and ready in 207.844 ms; Mac at 0.4125 took 0.900 / 200.774 ms. Weighted progress is not the percentage of captions completed or proof of video-encoding cancellation. Both subsequent exports completed. These four short runs are separate from long runs; Chrome's approximately 51.3 MiB headroom does not establish long-video behavior.

Harness v1 failed in Playwright `stream.promises.pipeline` before a product verdict. Moving package inspection to a separate Node process allowed upload, without establishing the library's root cause. Version 2 tried to close a background notification behind a modal; correcting the sequence avoided a forced click. Both failures were retained, and completed v3 was audited with unchanged product code.

## Initial long failure and decoder/list candidate

The first 60-minute run took 36.709 seconds for analysis, 191.498 for export, and 124.583 for the oracle. RSS **2.205 GiB** and caption p95 **239.359 ms** failed; effect/cut p95 was 193.366 / 66.899 ms. All 85,997 frames, 1,000 captions, 64 effects, complete SRT, and six markers passed. Cancellation at preparation progress 0.3009 took 1.0 / 216.199 ms and preserved work. The second long retry and other long conditions were `NOT_RUN` after the failure.

A one-filter-thread experiment was reverted. One decoder thread per source/PNG input preserved backend bytes while reducing observed backend RSS from 730.203 to 452.375 MiB; time changed from 3.579 to 3.537 seconds. This does not establish whole-app savings. A memoized CaptionList used primitive props and current handlers while retaining every row/button. Eighty unit tests and 36 media/caption/effect/compatibility/frame integrations passed. Both apps passed 1,000-row keyboard, unsaved-input, text/timing, undo, save/reopen, and actual Whisper TTS/caption flows. Build/package identities were checked. A sandbox-blocked RSS query was retained as a measurement failure before a permitted process-query rerun.

Four candidate short runs preserved output bytes, projects, oracles, and 384 actions. Chrome maximum RSS/action p95 was 1.681 GiB / 101.205 ms, compared with 1.950 GiB previously; Mac was 1.127 GiB / 59.948 ms, compared with 1.376 GiB. Cancellation feedback/readiness was 0.800 / 306.710 ms in Chrome and 0.900 / 199.605 ms on Mac; maximum sampling interval was 279.510 ms.

The first candidate 60-minute run took 37.012 / 193.932 / 124.542 seconds for analysis/export/oracle. RSS was 1.968 GiB with 32.375 MiB headroom, but caption p95 **224.978 ms** failed; effect/cut p95 was 196.958 / 67.308 ms. All output, project, byte, and sample-frame checks passed. Cancellation at progress 0.3006 took 1.100 / 224.539 ms and preserved work; the second long retry remained `NOT_RUN`. The recorded pre-run commit was `8aa2ef7`; actual files matched later commit `336d0e3`.

## Caption diagnostics and CSS candidate

These separate 32-action diagnostics are not formal repetitions:

| Condition | p95 / maximum (ms) |
| --- | --- |
| Project only | 145.416 / 282.421 |
| Empty source VTT | 198.863 / 264.640 |
| Actual analysis/waveform | 204.211 / 221.280 |
| No background blur | 205.592 / 209.739 |
| Offscreen content visibility | 185.047 / 190.624 |

VTT and blur controls did not justify product changes. The final control reduced TaskDuration from 2.186 to 1.883 seconds and frame tasks from 2.695 to 2.305 seconds in one diagnostic. Native PID identity was audited; mostly unnamed Chrome offsets prevent identifying a function-level cause. Physical footprint is not substituted for RSS. Invalid direct React track removal, missed project confirmation, and an incorrect single-renderer assumption remain runner failures, not product or performance results.

The CSS candidate adds content visibility and estimated height while retaining buttons, text, times, VTT, and design. Packaging initially failed on sandbox DNS, then succeeded with pinned Electron 44.2.0 over permitted networking; this was not an approval rejection. Both apps passed 1,000-row tests. Blank neighboring rows in an initial scroll capture led to visible-row/text/seek-readiness checks. Additional waits were 28.336 ms in Chrome and 20.392 ms on Mac, with stable rows 999/1000 viewed; these are not p95 measurements. The runner additionally records the CSS hash.

Four CSS short runs retained identical outputs and successful cancellation/retry. Chrome maximum RSS/action p95 was 1.689 GiB / 100.193 ms; Mac was 1.113 GiB / 59.954 ms. Maximum sample interval was 277.892 ms.

| `0804f39` long run | Analysis / export / oracle (s) | RSS (GiB) | Caption / effect / cut p95 (ms) |
| --- | --- | --- | --- |
| 1 | 36.713 / 193.520 / 124.703 | 1.962 | 183.357 / 198.350 / 66.265 |
| 2 | 37.123 / 194.743 / 124.727 | **2.140 FAIL** | 184.149 / 197.656 / 66.442 |

Both outputs passed all 85,997 frames, 1,000 captions, 64 effects plus two excluded effects, six markers, and complete project/SRT/MP4 checks. MP4 SHA-256 was `3dd0d93f77ecfbe51fc1589e12906c978e82be06eff17dcfc7fc953dba85873a`. Maximum sample intervals were 279.691 / 280.448 ms. Cancellation at preparation progress 0.3006 took 1.100 / 223.712 ms, preserved work, and was followed by a completed second output.

The third browser run, Mac 60-minute runs, and both 10-minute conditions were stopped. At encoding peaks, renderer RSS rose from 403.688 to 516.563 MiB and server RSS from 212.750 to 253.094 MiB; this is not proof of a leak. Preserve the failure and unchanged criteria without subtracting estimated automation cost from RSS.

## Evidence and related records

- [2026-09-06-composition-oracle-results.md](2026-09-06-composition-oracle-results.md)
- [2026-09-06-composition-app-smoke.json](results/2026-09-06-composition-app-smoke.json)
- [2026-09-06-composition-app-smoke-audit.json](results/2026-09-06-composition-app-smoke-audit.json)
- [2026-09-06-composition-app-driver-failure.json](results/2026-09-06-composition-app-driver-failure.json)
- [2026-09-06-composition-app-modal-failure.json](results/2026-09-06-composition-app-modal-failure.json)
- [2026-09-06-composition-long-before.json](results/2026-09-06-composition-long-before.json)
- [2026-09-06-composition-long-before-verification.json](results/2026-09-06-composition-long-before-verification.json)
- [2026-09-06-composition-memory-plan.md](../plans/2026-09-06-composition-memory-plan.md)
- [2026-09-06-composition-render-decoder-comparison.json](results/2026-09-06-composition-render-decoder-comparison.json)
- [2026-09-06-caption-list-e2e.json](results/2026-09-06-caption-list-e2e.json)
- [2026-09-06-composition-candidate-captions-e2e.json](results/2026-09-06-composition-candidate-captions-e2e.json)
- [2026-09-06-composition-app-candidate-smoke.json](results/2026-09-06-composition-app-candidate-smoke.json)
- [2026-09-06-composition-app-candidate-smoke-audit.json](results/2026-09-06-composition-app-candidate-smoke-audit.json)
- [2026-09-06-composition-render-sandbox-failure.json](results/2026-09-06-composition-render-sandbox-failure.json)
- [2026-09-06-composition-long-candidate.json](results/2026-09-06-composition-long-candidate.json)
- [2026-09-06-composition-long-candidate-audit.json](results/2026-09-06-composition-long-candidate-audit.json)
- [2026-09-06-composition-long-candidate-verification.json](results/2026-09-06-composition-long-candidate-verification.json)
- [caption-ui-diagnostic.mjs](../../scripts/caption-ui-diagnostic.mjs)
- [2026-09-06-caption-ui-normal.json](results/2026-09-06-caption-ui-normal.json)
- [2026-09-06-caption-ui-empty-vtt.json](results/2026-09-06-caption-ui-empty-vtt.json)
- [2026-09-06-caption-ui-analyzed.json](results/2026-09-06-caption-ui-analyzed.json)
- [2026-09-06-caption-ui-flat.json](results/2026-09-06-caption-ui-flat.json)
- [2026-09-06-caption-ui-contained.json](results/2026-09-06-caption-ui-contained.json)
- [2026-09-06-caption-ui-native-audit.json](results/2026-09-06-caption-ui-native-audit.json)
- [2026-09-06-caption-ui-native.json](results/2026-09-06-caption-ui-native.json)
- [2026-09-06-caption-ui-invalid-dom-control.json](results/2026-09-06-caption-ui-invalid-dom-control.json)
- [2026-09-06-caption-ui-analyzed-driver-failure.json](results/2026-09-06-caption-ui-analyzed-driver-failure.json)
- [2026-09-06-caption-ui-renderer-identity-failure.json](results/2026-09-06-caption-ui-renderer-identity-failure.json)
- [2026-09-06-caption-contained-list-e2e.json](results/2026-09-06-caption-contained-list-e2e.json)
- [2026-09-06-caption-contained-visible-e2e.json](results/2026-09-06-caption-contained-visible-e2e.json)
- [2026-09-06-composition-contained-smoke.json](results/2026-09-06-composition-contained-smoke.json)
- [2026-09-06-composition-contained-smoke-audit.json](results/2026-09-06-composition-contained-smoke-audit.json)
- [2026-09-06-composition-contained-long.json](results/2026-09-06-composition-contained-long.json)
- [2026-09-06-composition-contained-long-audit.json](results/2026-09-06-composition-contained-long-audit.json)
- [2026-09-06-composition-contained-first-audit.json](results/2026-09-06-composition-contained-first-audit.json)
- [2026-09-06-composition-contained-long-second-verification.json](results/2026-09-06-composition-contained-long-second-verification.json)
