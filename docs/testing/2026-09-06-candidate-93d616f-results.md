# Threshold editing on readiness candidate 93 d 616 f

2026-09-06. Frozen browser/native package after transcription-readiness recovery. **Eight short and 24 long runs completed and audited**, with four short and eight long cancel/retry conditions. This is threshold-only evidence, not full MVP or human quality acceptance.

Environment: M 4 Max/36 GiB/AC, Node 24.14.1/FFmpeg 8.1.1, synthetic 1080p / 30 fps H. 264/AAC tone/flash input, −40 dBFS/500 ms/100 ms pre-padding / 150 ms post-padding, VAD off. All 347 product/bundle/package/runner files remained fixed; manifest controls accepted original and rejected changed hash/missing entry without modifying product files.

## Short controls

Warm/cold × both apps × twice = eight. Maxima:

| Cache | Runs | Analysis s | Export s | RSS GiB | Action-group p95 ms |
| --- | --- | --- | --- | --- | --- |
| Warm | 4 | 1.361 | 3.511 | 1.627 | 67.24 |
| Cold | 4 | 1.408 | 3.494 | 1.625 | 67.08 |

Input 1,207,118 bytes/74 pages: all 74 resident warm, zero cold immediately before selection. File-level residency does not establish OS/executable/upload-copy cache. Report actual import/analysis excluding preparation, and export including app validation.

All outputs: 16 cuts, 1,448 frames/PTS, six A/V marker pairs, full project, ≈48.267 s. All MP4 SHA-256 `f6a0ca24ac51507d5eb61cec94b673cc3f96e3d9790651b0d3a9195e5147a7f1`. This was not a new all-pixel comparison. Cold matched same-candidate warm; first warm self-comparison is internal consistency, separate from independent media oracle.

Short cancel happened at running/preparation/progress 0: max visible 0.81 ms, retry 311.86 ms, second repetitions completed. Preserve project/MP4; do not call it mid-decode cancellation. Union RSS includes saves/project/cancel, excludes driver; max observed completed-phase interval 290.54 ms. 32 actions each for restore/settings/playback. Native paths supplied by runner, not OS-dialog evidence.

## Warm long matrix

| App/input | Runs | Max analysis s | Max export s | Max RSS GiB | Max action p95 ms |
| --- | --- | --- | --- | --- | --- |
| Chrome / 60 min | 3 | 37.636 | 170.107 | 1.883 | 68.15 |
| Mac / 60 min | 3 | 36.446 | 169.373 | 1.259 | 49.34 |
| Chrome / 10 min | 3 | 6.658 | 28.634 | 1.709 | 67.23 |
| Mac / 10 min | 3 | 6.442 | 28.890 | 1.114 | 40.27 |

Displayed maxima rounded upward; raw values preserved. 60 min: 1,000 cuts/85,997 frames; 10 min: 166 cuts/14,348 frames. All PTS, six marker pairs, full decode/project comparisons passed. Per-duration bytes identical across apps/repeats:

- 60 min SHA-256 `b43732d6d879804b5a6cd22d33ea48a3c572c1a7b999bc2f37f50001bf3c6fd1`.
- 10 min SHA-256 `829ed8db39fd65a02ce24635ebf13b2beb650911db72e9be45a16090a716edf4`.

Inputs 71,258,047/11,893,738 bytes, 4,350/726 pages all resident before selection. Post-work source/copy hashes preserved. Max sample interval 285.70 ms. Four preparation/progress 0 cancels: max visible 0.91 ms, retry 309.67 ms, next repetitions completed.

## Cold long matrix

| App/input | Runs | Max analysis s | Max export s | Max RSS GiB | Max action p95 ms |
| --- | --- | --- | --- | --- | --- |
| Chrome / 60 min | 3 | 37.470 | 169.525 | 1.933 | 67.81 |
| Mac / 60 min | 3 | 35.485 | 168.519 | 1.250 | 49.27 |
| Chrome / 10 min | 3 | 6.382 | 28.020 | 1.720 | 68.03 |
| Mac / 10 min | 3 | 6.371 | 27.960 | 1.144 | 41.37 |

All 4,350/726 pages nonresident immediately before selection. Analysis/projects/outputs matched same-candidate warm, including the above MP4 hashes. Max sample interval 284.88 ms. Four preparation/progress 0 cancels: visible≤0.91 ms, retry≤310.74 ms, next repetitions completed.

Completed reports/audits are byte/hash-identical copies of originals. Final file-set/hash audit and sequential driver exit 0. Long 24/24 meets 2 GiB with max≈1.933; short eight and earlier-candidate passes/failures remain separate. Human speech/time, current-candidate long composition, authenticated AI, clean-Mac install, native OS network block, and whole-OS cold cache are not established.

## Evidence and related records

- [2026-09-06-transcription-readiness-results.md](2026-09-06-transcription-readiness-results.md)
- [2026-09-06-thousand-cut-performance-plan.md](../plans/2026-09-06-thousand-cut-performance-plan.md)
- [2026-09-06-candidate-93d616f-threshold-smoke.json](results/2026-09-06-candidate-93d616f-threshold-smoke.json)
- [2026-09-06-candidate-93d616f-threshold-warm-matrix.json](results/2026-09-06-candidate-93d616f-threshold-warm-matrix.json)
- [2026-09-06-candidate-93d616f-threshold-warm-matrix-audit.json](results/2026-09-06-candidate-93d616f-threshold-warm-matrix-audit.json)
- [2026-09-06-candidate-93d616f-threshold-cold-matrix.json](results/2026-09-06-candidate-93d616f-threshold-cold-matrix.json)
- [2026-09-06-candidate-93d616f-threshold-cold-matrix-audit.json](results/2026-09-06-candidate-93d616f-threshold-cold-matrix-audit.json)
