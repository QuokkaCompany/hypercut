# Long-video composition with cuts, captions, and effects

2026-09-06. Two-thread encoder candidate `3e6db03` passed four short both-app runs and 12 long runs (10/60 minutes × both apps × three). Maximum browser RSS: 1.956 GiB; Mac 60-minute RSS: 1.161/1.097/1.099 GiB. Output/oracle/project/interactions/cancel-retry were preserved; all 85,997 frames, PTS, and audio matched the prior candidate. See [final audit](../testing/2026-09-06-encoder-two-results.md). Retain the [windowed-list third-run failure](../testing/2026-09-06-windowed-lists-results.md) at 2.008 GiB. Cache conditions and human/authenticated-AI evaluation remain separate.

This covers C05/C09/C10/FX05 in the [caption/effect plan](2026-09-05-caption-effects-validation-plan.md). Current implementation combines [encoder limits](2026-09-06-encoder-concurrency-plan.md) and [windowed lists](2026-09-06-windowed-lists-plan.md), retaining all logical data and independent project/SRT comparisons.

## Input and independent expectations

Use fixed-hash simple 1080p30 H.264/AAC 48 kHz synthetic tone/flash media with 3.6-second periods and 1,000 cuts in 60 minutes. It is not human speech. Put distinct numbered Korean manual captions from period+0.8 to +2.2 seconds: 1,000 in 60 minutes, 166 in 10 minutes, deliberately not crossing amplitude cuts. This does not test transcription accuracy.

Use one 880 Hz/48 kHz PCM effect distinct from the 440 Hz source. Place 64 long-input clips across first/middle/last periods, or fewer for short fixtures, at period+1.6 seconds for 0.25 seconds with nonclipping amplitude. Include separately muted and deleted-start clips, without another effect overlapping the mute-check region. Stay within 128 clips. Calculate source/asset/edited timing independently of app mapping.

Use yellow emphasis captions distinct from white flashes/background. Compare every project/SRT text entry, all caption presence/absence times, and actual wording frames at first/middle/last. Selected frames do not establish every glyph's visual accuracy.

## Actual app sequence

1. Validate oracle, reconnect, and detectors with 60-second composition in both apps; do not count smoke runs as long repetitions.
2. Import/analyze, open the manual-caption/style/effect project, reconnect the actual asset, and compare complete saved state to the oracle.
3. Save SRT and composed MP4. Fully decode and check all SRT text/timing, caption timing, effect onset/duration/gain/leakage, accumulated A/V markers, and unchanged source/asset hashes.
4. After a successful export, start another and cancel during actual caption preparation or video rendering. Record actual phase/progress, cleanup, unchanged full project and prior output bytes, and successful next repetition.
5. After output verification, perform 32 caption select/edit, 32 effect gain/mute, and 32 cut restore/undo actions. Check changed state, invalidated outputs, full restoration, response time, and preserved source-time project values.

## Measurement and acceptance

Run 10/60 minutes × Chrome/Mac × three; start with Chrome 60 minutes and stop expanding on failure. Reuse the app within each condition, freeze inputs/fonts/engine/build/package/runner/hardware/power/cache, and avoid other media work.

Analysis ≤20% of input duration; composed export including app validation ≤100%; union app/child RSS ≤2 GiB; each action group's p95 ≤200 ms; visible cancel ≤300 ms; retry readiness ≤5 seconds. The 4 GiB transcription limit does not apply because inference is absent. Sample RSS every 250 ms across analysis, caption preparation, mixing, encoding, validation, saves, and UI; report actual sample intervals. Record selector mode and do not subtract estimated automation costs. External independent oracle processes are excluded; the app's own validation remains included.

Require full kept-frame count and every expected PTS. A/V and caption boundaries allow one local frame, SRT rounding 1 ms. For this 30 fps fixture, caption/effect timing tolerance is 1/30 second. Freeze amplitude tolerance at 0.006 before smoke tests. Detect 880 Hz with 20 ms Hann windows, 5 ms steps, and amplitude ≥0.012; measure interior gain at least 40 ms from boundaries. Zero muted/deleted leakage, source changes, lost saved state, or false success with omitted captions/effects.

## Historical failures retained

The first 60-second composition produced 1,463 frames instead of 1,448, also without captions. Fix decimal time comparisons and integer PTS conversion, then compare every kept frame/count/content/PTS for CFR, captioned CFR, and shifted-start VFR. [Oracle record](../testing/2026-09-06-composition-oracle-results.md) preserves reproduction and corrected results. Old long performance is pre-fix evidence only.

[Both-app controls](../testing/2026-09-06-composition-app-results.md) ran twice per app, canceling caption preparation between successful outputs, with 96 actions/run. Caption-strip candidate `5002212` passed short/pixel/media checks, then browser long runs reached 1.946 and 2.045 GiB (second failed), with exports 157.127/157.697 s. Third/other long runs were not executed; outputs/projects/interactions/retry remained correct. See [strip evidence](../testing/2026-09-06-caption-strip-results.md).

Runner `5bb88a8` changed remaining role lookups to scoped CSS while checking role/name/enabled state and preserving product/package/oracle/criteria. Four short checks passed; `test-output/composition-scoped-long/browser-long/` reached 1.976 then 2.146 GiB, failing repetition two. Preserve [selector comparison](../testing/2026-09-06-caption-selector-results.md); lookup changes did not resolve long memory.

This validates synthetic placement/composition/resource use. Human Korean CER, natural pacing/effect listening, active editing-time savings, authenticated AI quality, whole-OS cold-cache, and native offline blocking remain separate.
