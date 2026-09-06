# Threshold-only editing and 1,000-cut performance

Created 2026-09-06 under [P01/P02](2026-09-05-test-plan.md). Initial target: browser/Mac at `3bfd26d`, adding runner/evidence without product changes after encoder-memory improvements.

Use identical simple 1080p30 H.264/AAC 48 kHz: 10 minutes/166 cuts and 60 minutes/1,000 cuts, VAD off, three repetitions per app. Measure selection→upload/inspection/hash/frame index/analysis/editable cuts ≤20% of duration; export click→full decode/save readiness ≤duration. Final chosen-path save time is separate.

Sample simultaneous app/child union RSS every 250 ms across analysis/export/file save/actions, excluding driver, target ≤2 GiB; sample errors fail. Perform 32 restore/undo, 32 settings, 32 play/pause operations; each group's p95 ≤200 ms including automation and two frame updates. After first analysis, cancel reanalysis: visible ≤300 ms, cleaned up/retry-ready ≤5 s, full project preserved, next repetition completes retry.

Check cut counts/repeated boundaries/full projects/source hashes/output duration/full decode. Independently detect first/middle/last flash/audio markers against simple cumulative removed-duration arithmetic. Allow 1/30 s and check additional A/V error and first-to-last drift. The last of 1,000 cuts removes trailing silence, so the last marker follows 999 deletions.

Freeze app/package/fixture/environment hashes, never overwrite result directories, retain failures, and report median/max from three media runs. Smoke-test both apps at 60 seconds, then run 12 long conditions sequentially, fresh app first then reused. OS caches are not purged. Synthetic simple material does not establish human quality, cold-cache, long caption/effect composition, or all G3.

[Initial outcome](../testing/2026-09-06-thousand-cut-performance-results.md): 12 completed; third browser 60-minute RSS failed, other 11 met targets. Do not report the complete matrix as passing.

## Cache-aware retesting

Later two-thread composition passed 12 runs, but plain output is a separate media path. Preserve old failures and retest threshold-only on the current app/package. Add verified `--input-cache=uncontrolled|cold|warm` to `threshold-benchmark.mjs`, defaulting to the original path, without product/quality/oracle changes.

Create fresh copies per cold/warm repetition, inspect residency immediately before selection, avoid preselection hashes, separately report preparation, and measure normal import+analysis. Check input hashes after analysis and after saves/actions. Preserve runner/server sources and compare browser/media files to package contents. Include project-save and cancellation RSS under the same 2 GiB target; omitted historical phases are unknown, not zero.

First run ordinary/cold/warm × both apps × two at 60 seconds, including cancellation. Then 10/60 minutes × both apps × cold/warm × three sequential long runs, stopping expansion on completed failures. Use `--ui-locator=css` with actual clicks/inputs/state checks and 32 samples; no estimated-cost subtraction or forced GC. Do not modify active composition runners; wait until they finish.

[Short controls](../testing/2026-09-06-threshold-input-cache-results.md): 12 runs, six cancel/retry conditions, auditor accepted valid evidence and rejected seven mutations. `b60b115` then completed three browser 60-minute cold runs plus cancellation, maximum 1.472 GiB. Audit before changing code. Subsequent MCP changes create a different candidate; the other 21 planned runs were not automatically credited.

## MCP lifecycle candidate `86a5c4d`

[Lifecycle checks](../testing/2026-09-06-mcp-lifecycle-results.md): 12 delayed-response cases plus existing flows. Browser bundle `index-DNRAvftO.js`; Mac app.asar SHA-256 `5c5c2caa3e918a0ba83345cef8814d6a6822a0a5f062b3885d66f69d2778b25f`. Media source matched the earlier two-thread candidate, but UI/package changed.

Run warm/cold short two-app repetitions first, then browser 60-minute warm three times, followed by browser cold, Mac cold/warm, and both apps' ten-minute cold/warm if passing. New app per condition, reuse within three runs. Freeze product/package/runner/oracles until each audit completes. Preserve failed conditions and use a new candidate after fixes. Do not credit prior-candidate passes or infer composition/VAD/transcription performance.

The warm browser three-run condition completed at maximum 1.744 GiB and was audited before changes. T05 readiness still collapsed errors, so complete [readiness work](2026-09-06-transcription-readiness-plan.md) before the next matrix. Preserve the three runs in their [own record](../testing/2026-09-06-threshold-input-cache-results.md).

## Readiness candidate `93d616f`

After 22 readiness checks, both-app real recovery, and four existing transcription integration checks, freeze product/runner/browser/native files (347 entries).

| Batch | Completed evidence |
| --- | --- |
| 60-second warm, both apps, twice each | Four audited runs, cancel/retry, max RSS 1.627 GiB |
| 60-second cold, both apps, twice each | Four audited runs, cancel/retry, max RSS 1.625 GiB; compare same-candidate warm |
| 60-/10-minute warm, both apps, three each | 12 audited runs, four cancel/retry conditions, max 1.883 GiB |
| 60-/10-minute cold, both apps, three each | 12 audited runs, four cancel/retry conditions, max 1.933 GiB; compare warm |

Sequence preserved at `test-output/candidate-93d616f-threshold-matrix-run/run.sh`. Recheck file sets/hashes after each batch; stop on identity/audit/criterion failure. Manifest checker controls accepted an original copy and rejected changed hashes and missing entries without changing product files.

[Final candidate record](../testing/2026-09-06-candidate-93d616f-results.md): eight short plus 24 long runs, respectively four and eight cancellation conditions, final identity/cold-warm audits and sequential runner exit zero. This candidate's threshold matrix is complete. Human Korean quality, simultaneous composition, real AI, and distribution environments require separate judgments. Short runs and older candidates are not counted as long repetitions.
