# Threshold-mode input cache verification

2026-09-06. The threshold runner gained observed cold/warm input conditions while retaining the uncontrolled default. Preparation is separate from analysis, residency is checked immediately before file selection, and hashes are checked afterward. Project save and cancellation are included in RSS monitoring. Product behavior and limits were unchanged; execution stops on a measured failure.

## Initial short matrix

Twelve 60-second runs covered three cache conditions, two apps, and two repetitions, with six cancellation/retry conditions.

| Condition | Peak RSS (GiB) | Highest action p95 (ms) | Resident pages |
| --- | --- | --- | --- |
| Uncontrolled | 1.625 | 66.87 | Not constrained |
| Cold | 1.528 | 66.82 | 0 / 74 |
| Warm | 1.630 | 67.09 | 74 / 74 |

The input was 1,207,118 bytes. All outputs shared the recorded `f6a0ca24ac51507d5eb61cec94b673cc3f96e3d9790651b0d3a9195e5147a7f1` hash, 1,448 frames, 16 cuts, six markers, and complete project content. This is not a full-pixel comparison; an output compared with itself is an internal consistency check rather than an independent correctness oracle. The longest RSS sample interval was 318.82 ms. Cancellation happened early, not midstream.

Eight audit controls accepted one valid report and rejected seven altered copies: lowered RSS, lowered p95, changed frame count, changed hash, missing repetition, changed project, and invalid cold residency. Only copied test data were modified.

## Candidate `b60b115`: browser 60-minute cold runs

| Run | Analysis (s) | Export (s) | RSS (GiB) |
| --- | --- | --- | --- |
| 1 | 37.644 | 182.753 | 1.472 |
| 2 | 39.210 | 181.904 | 1.448 |
| 3 | 37.599 | 182.787 | 1.470 |

Each 71,258,047-byte input had 0 / 4,350 resident pages. Outputs contained 1,000 cuts, 85,997 frames, and six markers, with the same recorded `b43732d6d879804b5a6cd22d33ea48a3c572c1a7b999bc2f37f50001bf3c6fd1` hash. Preparation-stage cancellation became visible in 0.8 ms and ready in 308.99 ms, followed by a successful retry. This was not a comparison against an earlier candidate.

Only three of the 24 long conditions were completed before MCP changed the product. The remaining 21 are not completed results for this candidate. Composition-cache measurements are separate.

```sh
node scripts/threshold-benchmark.mjs --durations=60 --surfaces=browser,desktop --iterations=2 --ui-locator=css --input-cache=cold --output=test-output/FRESH_RUN_NAME
```

Audit the fresh report before extending the matrix.

## MCP lifecycle candidate `86a5c4d`

Eight short runs and four cancellation/retry conditions passed. Warm maximum analysis/export/RSS/action-p95 values were 1.347 seconds / 3.512 seconds / 1.623 GiB / 67.11 ms. Cold maxima were 1.364 seconds / 3.512 seconds / 1.618 GiB / 66.86 ms. Residency, 1,448 frames, and the `f6a0ca24ac51507d5eb61cec94b673cc3f96e3d9790651b0d3a9195e5147a7f1` output identity matched. Maximum cancellation feedback/readiness was 0.8 / 312.67 ms, followed by successful retries.

| Browser 60-minute warm run | Analysis (s) | Export (s) | RSS (GiB) |
| --- | --- | --- | --- |
| 1 | 37.558 | 176.447 | 1.744 |
| 2 | 37.353 | 177.665 | 1.577 |
| 3 | 37.594 | 180.608 | 1.634 |

All runs observed 4,350 / 4,350 resident pages and passed post-run hashes. Outputs matched the `b43732d6d879804b5a6cd22d33ea48a3c572c1a7b999bc2f37f50001bf3c6fd1` identity, 1,000 cuts, 85,997 frames, and six markers; no complete pixel comparison is claimed. Highest action p95 was 67.36 ms. Cancellation at preparation progress 0 became visible in 0.8 ms, ready in 313.29 ms, and the next run completed.

This candidate completed three of 24 long conditions. Do not combine its warm results with the previous candidate's cold results. Later transcription-readiness changes require their own performance measurements.

## Evidence and related records

- [2026-09-06-thousand-cut-performance-plan.md](../plans/2026-09-06-thousand-cut-performance-plan.md)
- [2026-09-06-threshold-cache-smoke-summary.json](results/2026-09-06-threshold-cache-smoke-summary.json)
- [2026-09-06-threshold-cache-smoke-uncontrolled.json](results/2026-09-06-threshold-cache-smoke-uncontrolled.json)
- [2026-09-06-threshold-cache-smoke-uncontrolled-audit.json](results/2026-09-06-threshold-cache-smoke-uncontrolled-audit.json)
- [2026-09-06-threshold-cache-smoke-cold.json](results/2026-09-06-threshold-cache-smoke-cold.json)
- [2026-09-06-threshold-cache-smoke-cold-audit.json](results/2026-09-06-threshold-cache-smoke-cold-audit.json)
- [2026-09-06-threshold-cache-smoke-warm.json](results/2026-09-06-threshold-cache-smoke-warm.json)
- [2026-09-06-threshold-cache-smoke-warm-audit.json](results/2026-09-06-threshold-cache-smoke-warm-audit.json)
- [2026-09-06-threshold-cache-audit-controls.json](results/2026-09-06-threshold-cache-audit-controls.json)
- [2026-09-06-threshold-cache-browser-3600-cold.json](results/2026-09-06-threshold-cache-browser-3600-cold.json)
- [2026-09-06-threshold-cache-browser-3600-cold-audit.json](results/2026-09-06-threshold-cache-browser-3600-cold-audit.json)
- [2026-09-06-thousand-cut-performance-results.md](2026-09-06-thousand-cut-performance-results.md)
- [2026-09-06-input-cache-results.md](2026-09-06-input-cache-results.md)
- [2026-09-06-final-candidate-threshold-smoke.json](results/2026-09-06-final-candidate-threshold-smoke.json)
- [2026-09-06-thousand-cut-performance-plan.md](../plans/2026-09-06-thousand-cut-performance-plan.md#mcp-lifecycle-candidate-86a5c4d)
- [2026-09-06-candidate-86a5c4d-browser-3600-warm-audit.json](results/2026-09-06-candidate-86a5c4d-browser-3600-warm-audit.json)
- [2026-09-06-candidate-86a5c4d-browser-3600-warm.json](results/2026-09-06-candidate-86a5c4d-browser-3600-warm.json)
- [2026-09-06-transcription-readiness-plan.md](../plans/2026-09-06-transcription-readiness-plan.md)
