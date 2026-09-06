# Editor rendering reuse: both candidates failed memory limits

2026-09-06. Baseline browser RSS for a 60-minute input with 1,000 cuts was 2.050 GiB. Memoized lists and static waveform/tick/cut layers preserved playback, selection, timeline, and job-lock behavior. Neither candidate solved the third-run failure against the 2 GiB limit.

## First candidate

Seventy-five unit tests, build, packaging (`index-DLKel73C.js`), and 54 UI conditions passed: timing (2), ordinary flows (2), project I/O (8), job races (34), and effect import (8). A 16-second source with cuts `[2, 4)` and `[8, 10)` mapped source 7.5 seconds to edited 5.5 seconds; restoring the first cut returned it to 7.5. A new three-cut project mapped source 11.5 seconds to edited 8.5. Playback, selection, undo, zoom, job locks, complete saved cuts, source hashes, and visual behavior were checked in both apps. The initial expected project omitted `reason: silence`; the fixture was corrected and its failure preserved.

Three Chrome 60-minute runs used the same runner, input, encoder, and quality settings. Full analyses, projects except timestamps, and MP4 bytes matched baseline. RSS rose from 1.872 to 1.950 to **2.172 GiB**, failing the third run. Export median/max was 141.256 / 141.602 seconds; timing, interaction, sync, and cancellation/retry passed. The third renderer reached approximately 599 MiB; UI-phase renderer values were approximately 551 / 562 / 594 MiB. Remaining row/icon rebuild work was observed without proving a leak. The source base was `b6a161e` with uncommitted UI changes; the manifest identifies actual CutList/App/Timeline/bundle/server/runner/package hashes. Other long conditions were not expanded after failure.

## Second candidate

Individual rows were reused and the waveform/tick background separated from cut markers, retaining current delegated handlers, buttons, scrolling, and timing. Seventy-five unit tests, build, and packaging (`index-4MyEqYPb.js`) passed. Twelve UI conditions covered timing/Space/Enter (2), ordinary flows (2), and project I/O (8). The first candidate's 42 job/import race conditions were not rerun.

| Run | Analysis (s) | Export (s) | RSS (GiB) | Verdict |
| --- | --- | --- | --- | --- |
| 1 | 37.362 | 142.123 | 1.860 | PASS |
| 2 | 37.381 | 141.570 | 1.924 | PASS |
| 3 | 37.421 | 141.682 | **2.145** | Memory FAIL |

Full analyses/projects/MP4 hashes, full decoding, and 18 marker pairs matched. Highest action p95 was 115.449 ms. Early PCM cancellation became visible in 1 ms and ready in 314.676 ms, preserving the project; the next repetition completed. This is not midstream cancellation evidence. Maximum sampling interval was 295.465 ms. Third-run encoding peaks were renderer 587.94, FFmpeg 390.28, and server 242.31 MiB, compared with 333.08 / 405.11 / 209.13 MiB in the first run. Other Chrome children remained included. The remaining nine runs were `NOT_RUN`; both source snapshots and the original criteria were preserved.

## Separate interaction diagnostic

After one import/analysis, three cycles each performed 32 restore/undo, 32 settings, and 32 play/pause actions: 288 total, without repeated import/export or forced GC. From the first restore through final idle, DOM count stayed at 11,962 with 1,000 rows, and cut state was restored. Used heap after each cycle was 19.240 / 10.599 / 29.325 MiB; after five idle seconds it was 29.331 MiB used and 76.250 MiB allocated. Listener counts rose and fell rather than increasing monotonically.

App peak RSS was 1.673 GiB and the last largest renderer was 543.47 MiB. There were 352 samples, a maximum interval of 276.746 ms, and no recorded sampling, app, external-request, or source errors. Heap/DOM measurements differ from RSS. The diagnostic includes CDP/Playwright overhead and neither proves nor rules out a leak; it cannot replace export-inclusive formal runs. Playback/lookup cost and repeated import/export lifetime require separate investigation. Human quality/time, cold caches, long composition, and authenticated AI remain separate.

## Evidence and related records

- [2026-09-06-thousand-cut-performance-results.md](2026-09-06-thousand-cut-performance-results.md)
- [2026-09-06-editor-render-memory-plan.md](../plans/2026-09-06-editor-render-memory-plan.md)
- [2026-09-06-editor-render-e2e.json](results/2026-09-06-editor-render-e2e.json)
- [2026-09-06-editor-render-regressions.json](results/2026-09-06-editor-render-regressions.json)
- [2026-09-06-editor-render-project-io.json](results/2026-09-06-editor-render-project-io.json)
- [2026-09-06-editor-render-job-races.json](results/2026-09-06-editor-render-job-races.json)
- [2026-09-06-editor-render-effect-import.json](results/2026-09-06-editor-render-effect-import.json)
- [2026-09-06-editor-render-browser-long.json](results/2026-09-06-editor-render-browser-long.json)
- [2026-09-06-editor-render-audit.json](results/2026-09-06-editor-render-audit.json)
- [2026-09-06-editor-render-row-e2e.json](results/2026-09-06-editor-render-row-e2e.json)
- [2026-09-06-editor-render-row-regressions.json](results/2026-09-06-editor-render-row-regressions.json)
- [2026-09-06-editor-render-row-project-io.json](results/2026-09-06-editor-render-row-project-io.json)
- [2026-09-06-editor-render-row-source.json](results/2026-09-06-editor-render-row-source.json)
- [2026-09-06-editor-render-row-browser-long.json](results/2026-09-06-editor-render-row-browser-long.json)
- [2026-09-06-editor-render-row-audit.json](results/2026-09-06-editor-render-row-audit.json)
- [2026-09-06-editor-memory-diagnostic.json](results/2026-09-06-editor-memory-diagnostic.json)
- [2026-09-06-editor-memory-diagnostic-audit.json](results/2026-09-06-editor-memory-diagnostic-audit.json)
