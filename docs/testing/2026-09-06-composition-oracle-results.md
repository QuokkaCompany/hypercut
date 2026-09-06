# Whole-frame checks found and fixed cut-boundary errors

2026-09-06. A 60-second 1080p/30 fps source with 16 cuts should produce 48.266667 seconds and 1,448 frames. The old output contained 1,463 frames, even without captions or effects. Original output and failure evidence are retained. Nine-decimal serialization compared `83/30 ≈ 2.7666666667` against `2.766666667`, retaining a deletion-boundary frame. Conversion of fractional output ticks also rounded incorrectly.

`shared/timeline.mjs` now compares `pts`/`PTS` with `round(boundary/TB)`. `server/media.mjs` rounds the start offset and cumulative removals to integer ticks without duplicating input frames to force a fixed frame rate. Independent fixtures vary frame brightness and derive expected arrays from source timestamps and cuts, checking every frame count, PTS, and top-region pixel.

| Condition | Before | After |
| --- | --- | --- |
| 30 fps CFR | 282 frames; expected 280 | 280; all content and PTS checks passed |
| Captioned 30 fps | 282 frames; expected 280 | 280; all checks passed |
| 29.97-based VFR / +3 s PTS / captions | One-tick error after the first cut | 220; all checks passed |

The same three tests failed before and passed after the fix. Maximum brightness error was zero and maximum floating-point timing difference approximately 1.78e−15 seconds. This is not a universal lossless-video guarantee.

## Oracle controls and actual composition

The independent `composition-oracle.mjs` imports no product timeline, caption, or effect functions. Five pure tests distinguish SRT text/order/timing and missing, late, short, wrong-gain, extra, or truncated audio, as well as missing, delayed, or extra captions/frames. Four codec tests contain ten controls: two valid outputs accepted and eight corrupt outputs rejected. Yellow rectangles calibrate presence detection, not Korean glyph quality. A quoting error initially failed generation of the tenth fixture after nine; the failure was preserved, generation corrected, and all ten controls completed.

The threshold runner gained complete frame-count/PTS checks and rejected the actual old output while accepting the corrected output. Seven threshold-sync integrations accept valid output and reject missing/extra frames, a 200 ms audio delay, and missing markers.

| Post-fix 60-second composition check | Result |
| --- | --- |
| Frames and captions | 1,448 frames; all presence, absence, and timing checks passed |
| SRT | 16 texts in order; maximum rounding error 0.333 ms |
| Effects | 16 onset, end, and interior-gain checks; no muted/deleted leakage |
| AAC | 2,317,312 decoded samples; peak ≈0.19125; 880 Hz interior ≈0.049925–0.050340 |
| A/V markers | Six pairs; maximum additional error ≈0.000333 ms |
| Source and asset | Hashes preserved |

Amplitude tolerance remained 0.006, timing tolerance 1/30 second, and AAC tail at most one frame. Pixel detection checks caption presence, not every word. Separate viewing covered the first, middle, and last numbered Korean caption PNGs, 0001/0009/0016: yellow text, black stroke, lower-center placement, and no clipping. The automated report's `visualReview: NOT_RUN` remains accurate; viewing evidence is separate.

Eighty unit tests and 33 media/caption/effect/compatibility integrations passed. Thirty-one ran initially; two port-dependent FX03 cases passed after a permitted rerun following sandbox `EPERM`. Overlap is excluded from the count. Type checking, build, and packaging passed. Both apps passed 60-second threshold controls for import, analysis, save, complete projects, 96 actions per app, and all 1,448 frames/PTS, with matching package identities. Concurrent independent ffprobe work means those timings and resources are not standalone performance results.

At this stage, actual composed editing in both apps, long composition, cancellation/retry, RSS, and UI performance were not yet run; the later app record continues this work. Earlier CSS-based 12-run measurements remain pre-fix evidence. Human Korean quality/CER/pacing/listening/time, authenticated AI, native OS-level offline behavior, and OS-wide cold caches are separate.

```sh
node --test tests/frame-boundary.integration.mjs
node --test tests/composition-oracle.test.mjs
node --test tests/composition-oracle.integration.mjs
node --test tests/composition-smoke.integration.mjs
node --test tests/threshold-sync.integration.mjs
```

## Evidence and related records

- [2026-09-06-long-composition-plan.md](../plans/2026-09-06-long-composition-plan.md)
- [2026-09-06-composition-before.json](results/2026-09-06-composition-before.json)
- [ffmpeg-filters.html](https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect)
- [2026-09-06-frame-boundary-before.json](results/2026-09-06-frame-boundary-before.json)
- [2026-09-06-frame-boundary-after.json](results/2026-09-06-frame-boundary-after.json)
- [2026-09-06-composition-calibration-fixture-failure.json](results/2026-09-06-composition-calibration-fixture-failure.json)
- [2026-09-06-composition-calibration.json](results/2026-09-06-composition-calibration.json)
- [2026-09-06-whole-frame-output-comparison.json](results/2026-09-06-whole-frame-output-comparison.json)
- [2026-09-06-composition-after.json](results/2026-09-06-composition-after.json)
- [2026-09-06-composition-visual-review.json](results/2026-09-06-composition-visual-review.json)
- [2026-09-06-frame-boundary-app-smoke.json](results/2026-09-06-frame-boundary-app-smoke.json)
- [2026-09-06-frame-boundary-package.json](results/2026-09-06-frame-boundary-package.json)
- [2026-09-06-selector-overhead-results.md](2026-09-06-selector-overhead-results.md)
- [2026-09-06-composition-app-results.md](2026-09-06-composition-app-results.md)
