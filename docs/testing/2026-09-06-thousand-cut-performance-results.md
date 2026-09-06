# Threshold mode with 1,000 cuts: one memory failure

2026-09-06, candidate `3bfd26d`. All 12 long runs and four cancellation/retry conditions completed. Eleven runs met the measured targets; the third browser 60-minute run reached **2.050 GiB RSS**, exceeding the 2 GiB limit. The result is `completed`, `measuredGoalsPass: false`, exit code 1. Two short checks are separate from the matrix.

| Surface / duration | Analysis median / max (s) | Export median / max (s) | Peak RSS (GiB) | Highest action p95 (ms) |
| --- | --- | --- | --- | --- |
| Chrome / 10 min | 6.564 / 6.797 | 24.068 / 24.086 | 1.791 | 67.79 |
| Mac / 10 min | 6.325 / 6.409 | 24.039 / 24.041 | 1.194 | 48.38 |
| Chrome / 60 min | 37.107 / 37.299 | 141.378 / 141.449 | **2.050 FAIL** | 115.21 |
| Mac / 60 min | 36.813 / 36.820 | 142.384 / 142.459 | 1.404 | 90.48 |

Browser 60-minute peaks increased from 1.942 to 1.997 to 2.050 GiB. Peaks occurred during export, with renderer memory increasing after interactions. This does not establish the root cause.

## Runner and oracle checks

The independent sync verifier accepted a valid six-marker output and rejected a 200 ms audio delay, missing audio, and missing video. An exact-zero assertion encountered floating-point error of −4.44e−16; only that assertion was corrected, without relaxing the 1/30-second tolerance.

An initial 10-minute browser run passed, but its cancellation request arrived after completion. It was recorded as completed, not credited as a successful cancellation. The runner now checks that the job is running immediately before the request, requires both `cancelled: true` from DELETE and a terminal cancelled state, and records the cancellation stage without adding artificial delays. The original failure record is retained.

The final matrix includes 1,152 interactions. Cancellation occurred during preparation for 10-minute inputs and early amplitude processing for 60-minute inputs, at progress 0.15001–0.15008; it does not prove midstream PCM cancellation. DOM feedback took 1.8–7 ms and retry readiness 302–316 ms. Complete projects were preserved and subsequent runs completed.

Final file-copy medians were 0.245 / 0.055 seconds for browser/Mac 10-minute outputs and 1.214 / 0.100 seconds for 60-minute outputs. These copies are excluded from export timing but included in RSS monitoring. The maximum RSS sampling interval was 284 ms with no recorded sampling errors; shared pages and peaks between samples remain limitations.

## Environment and scope

M4 Max, 14 CPU cores, 36 GB RAM, AC power, Darwin 25.5, Node 24.14, FFmpeg 8.1.1. Sources stayed fixed through the audit and no competing media/build jobs ran. Synthetic inputs contain 440 Hz audio and simple 1080p/30 fps video. OS caches were not purged. The final cut removes trailing silence; the last sync marker follows 999 cuts.

Run the threshold sync verifier with concurrency 1 and the benchmark with a fresh output directory. These measurements do not establish human speech quality, editing-time savings, cache-conditioned performance, caption/effect composition, or the complete G3 release gate.

## Evidence and related records

- [2026-09-06-thousand-cut-performance-plan.md](../plans/2026-09-06-thousand-cut-performance-plan.md)
- [2026-09-06-thousand-cut-smoke.json](results/2026-09-06-thousand-cut-smoke.json)
- [2026-09-06-thousand-cut-cancel-timing.json](results/2026-09-06-thousand-cut-cancel-timing.json)
- [2026-09-06-thousand-cut-results.json](results/2026-09-06-thousand-cut-results.json)
- [2026-09-06-editor-render-memory-plan.md](../plans/2026-09-06-editor-render-memory-plan.md)
- [2026-09-06-thousand-cut-audit.json](results/2026-09-06-thousand-cut-audit.json)
