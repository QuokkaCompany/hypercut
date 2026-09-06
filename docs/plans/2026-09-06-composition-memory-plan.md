# Caption composition memory investigation

2026-09-06. First browser 60-minute composition peaked at 2.205 GiB union RSS, including FFmpeg about 669.97 MiB, above the unchanged 2 GiB target. Complete and preserve output/cancel/UI evidence separately.

[FFmpeg](https://ffmpeg.org/ffmpeg.html#Advanced-options) documents default complex-filter threads as available CPUs. Compare narrowly scoped candidates using the same 60-second backend input before expanding to app runs. Preserve actual source, project, output hashes, all frames/captions/effects/sync, raw RSS, process peaks, and time. Backend-only diagnostics do not establish whole-app performance.

## Decoder/filter and caption-response comparisons

| Candidate | Backend RSS MiB | Seconds | Decision |
| --- | --- | --- | --- |
| Baseline | 730.203 | 3.579 | Reference |
| One complex-filter thread | 713.141 | 4.684 | Insufficient improvement; reverted |
| One decoder thread per source/PNG input | 452.375 | 3.537 | Same output SHA-256/oracle; advance through regressions |

Keep encoder/resolution/frames/gain/quality targets. Regress CFR/VFR, PTS offset, range preview, three caption styles, effects; repackage and pass both apps' short composition/save/cancel/retry before long runs. Investigate unexplained bytes/correctness changes first and report time costs.

Initial long caption-action p95 was 239.359 ms. Memoize a separate caption list with primitive row props, retaining 1,000 rows, current handlers, keyboard controls, unapplied text protection, timing edits, undo/redo, and complete saved-project checks. The first rerun met memory at 1.968 GiB but failed caption p95 at 224.978 ms. Stop further conditions; a 32.375 MiB margin is not repeated stability. Preserve [app results](../testing/2026-09-06-composition-app-results.md).

`caption-ui-diagnostic.mjs` measures 32 actions on the same 1,000-caption project, separating delivered input, state checks, and two animation frames, with CDP traces and final project comparison. Instrumentation is separate from formal runs; event-to-frame timing alone is not visual correctness proof.

| Diagnostic | p95 / max ms | Interpretation |
| --- | --- | --- |
| No prior analysis/export | 145.416 / 282.421 | Diagnostic only |
| Test-only empty valid source VTT | 198.863 / 264.640 | Does not support VTT as main cause |
| Actual analysis/waveform present | 204.211 / 221.280 | Reproduces latency |
| Test-only background blur disabled | 205.592 / 209.739 | Does not support changing design |
| Offscreen rows with `content-visibility:auto` | 185.047 / 190.624 | Candidate; not a formal pass |

Directly removing React-owned track nodes caused a React removal error: invalid diagnostic, not a product defect/performance result. Diagnostics missing a project confirmation or assuming one renderer were runner failures. Native samples mostly resolved to ChromeMain offsets; about 98 ms top-level work did not identify a specific function. Confirm target PID through page markers/process lists. Keep raw scripts/results.

Content-visibility reduced one diagnostic's TaskDuration 2.186→1.883 s and frame-task sum 2.695→2.305 s. Inspect visible wording/timing/selection, then test both apps' last row, Enter/Space, text/timing edits, undo/redo/save and short composition before formal repetition. Do not add a unit test mirroring CSS.

The CSS candidate passed short/function checks. Long run one: 1.962 GiB, caption p95 183.357 ms; run two: 2.140 GiB, 184.149 ms, memory failure. Both outputs/oracles/bytes/projects and cancel→next output passed. Stop third/other conditions. At export peak, renderer grew 403.688→516.563 MiB and backend 212.750→253.094 MiB; do not label this a proven leak.

## Selector and video-lifetime diagnostics

`caption-selector-diagnostic.mjs` queries the same active SRT button 96 times by role or CSS without clicking/editing. Record three groups of RSS, browser heap/DOM/task time, and server heap through test-parent private IPC only. No HTTP memory endpoint or forced GC. Compare final project.

[Comparison audit](../testing/results/2026-09-06-caption-selector-comparison-audit.json): role/CSS TaskDuration increase 3.580/0.345 s; embedder heap 38.371→177.720 / 38.070→38.589 MiB. DOM/projects preserved. Different initial RSS and sample durations prevent assigning long-memory causation from peaks.

Scoped CSS in the formal runner verifies each target's tag/role/exact name/enabled state and preserves actual clicks/downloads/cancel/oracles and all app processes. Record runner/test-server hashes; keep product/bundle/package unchanged. Four [short runs](../testing/results/2026-09-06-composition-scoped-smoke.json) and [audit](../testing/results/2026-09-06-composition-scoped-smoke-audit.json) passed with identical bytes/projects/retry. Long runs reached 1.976 then 2.146 GiB, failing the second despite correct output/actions/retry. Preserve [raw](../testing/results/2026-09-06-composition-scoped-long.json) and [audit](../testing/results/2026-09-06-composition-scoped-long-audit.json). Lookup changes alone did not solve it.

Compare six caption-dialog open→seek second cue→close cycles with ordinary behavior versus test-only pause/remove `src`/load before actual close. Do not remove React DOM children. Observe RSS/heaps/DOM/server state, reopened video/VTT/text, and final project without forced GC/restarts. [Lifecycle audit](../testing/results/2026-09-06-caption-lifecycle-comparison-audit.json): baseline peak 1.737 GiB, explicit release 1.746 GiB; both preserved 1,000 cues, 4.4-second seek, and project. Insufficient support for a product change; final renderer differences alone do not diagnose leaks.

## Encoder comparison and caption strips

The long peak included about 406 MiB FFmpeg during encoding, before output decode verification. Sequential same-input backend comparison with fixed decoder/CRF/preset/resolution/audio/oracle:

| Encoder threads | RSS MiB | Seconds |
| --- | --- | --- |
| 4 | 451.359 | 3.524 |
| 2 | 413.875 | 3.995 |
| 1 | 372.406 | 6.796 |

[Evidence](../testing/results/2026-09-06-composition-encoder-comparison.json): all independent expectations and three sample-frame pixel hashes matched, but bitstreams changed. About 79 MiB saved with one thread did not establish long-run resolution; preserve results and restore four threads at this investigation stage.

Next reduce full-frame transparent PNG work to a common vertical strip. Calculate layout in original coordinates, include background/glyph ascent/descent/stroke/antialiasing margins, retain uniform PNG dimensions, and align y/height to even pixels where possible for 4:2:0. Use a small transparent strip for empty intervals. Keep full-canvas style samples, output resolution/fonts/CRF/preset/threads unchanged.

Require complete RGBA equality after placing strips back on the full canvas: landscape/portrait, three styles, top/bottom, multiline/large Korean and Latin text, and empty sequences. Cropped glyphs or shifted y fail. Regress real CFR/VFR/PTS/rotation/SAR/ranges/cancel, then compare backend MP4/oracle/RSS/time before app/long expansion.

The strip candidate passed four both-app short runs. Browser long exports took 157.127/157.697 s with identical MP4/SRT/project/oracle/action/retry results, but RSS 1.946/2.045 GiB failed repetition two. Preserve [strip results](../testing/2026-09-06-caption-strip-results.md); third/other conditions were not run. Keep the rendering improvement without claiming the repeated-memory problem solved.
