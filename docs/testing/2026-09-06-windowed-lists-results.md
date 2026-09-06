# Windowed cut and caption lists

2026-09-06. Lists with at least 200 items render visible, overscan, selected, and focused rows using dynamic heights while retaining all logical data. Smaller lists retain their earlier rendering path. The previous candidate's 2.045 GiB memory failure remains recorded.

## Functional and visual checks

All 80 unit tests, build, and packaging passed. Sixteen UI conditions covered large lists (2), editor behavior (2), captions (2), general flows (2), and project I/O (8). Nine style-preview conditions covered two browser widths across three styles plus three Mac styles.

A manually constructed 16-second project contained 1,000 cuts and cues; it is a navigation fixture, not a quality or performance sample. Both apps traversed all 1,000 captions with Tab and exercised 80 cut buttons using forward/backward navigation, Home/End, Enter/Space, final-cut restoration, Tab exit, and offscreen focus. Multiline editing, next-review navigation, unsaved-discard decline/accept, delete/undo, text/time undo, and project switching preserved complete project data except `savedAt`. Observed DOM rows ranged from 12–22 cuts and 8–15 captions.

A resize-cache reset moved the selected cue offscreen; preserving the logical anchor fixed it, and the result was viewed. A 150 px style grid inherited a 229 px minimum row height and cropped its bottom. Setting grid/image minimum heights to zero and using `object-fit: contain` changed the preview bounds from 407.094 × 228.984 to 407.094 × 150 px without changing MP4 rendering.

Final visual checks waited for the new response, decoded image, bounds, and pixels for every style. Earlier harness failures involving stale image references, exit handling, and save waits were retained rather than counted as passes; version 5 exited successfully. List reports preceded the preview-only CSS change, while the latest preview and project-I/O checks used the final package. Their source identities remain distinct.

## Candidate `3d572b4`: short composition checks

| Surface | Analysis (s) | Export (s) | RSS (GiB) |
| --- | --- | --- | --- |
| Chrome | 1.062 / 0.845 | 3.198 / 3.132 | 1.554 / 1.636 |
| Mac | 1.280 / 1.014 | 3.095 / 3.096 | 0.978 / 1.069 |

All four outputs retained 1,448 frames, 16 captions/effects, independent oracles, and byte equality with the earlier caption-strip candidate. Interaction p95 remained below 200 ms. Browser/Mac cancellation feedback was 0.9 / 0.8 ms, readiness 306.55 / 301.82 ms, followed by completed retries. Maximum RSS sample interval was below 278.85 ms. These short lists contain fewer than 200 rows and do not measure virtualization performance.

## Browser 60-minute repetitions

| Run | Analysis (s) | Export (s) | Oracle (s) | RSS (GiB) | Caption / effect / cut p95 (ms) |
| --- | --- | --- | --- | --- | --- |
| 1 | 36.669 | 156.985 | 125.073 | 1.773 | 67.23 / 101.54 / 66.15 |
| 2 | 36.999 | 158.026 | 125.905 | 1.922 | 66.85 / 119.71 / 65.63 |
| 3 | 37.689 | 160.405 | 126.200 | **2.008 FAIL** | 67.63 / 102.17 / 66.40 |

The third run exceeded the limit by 8.1875 MiB; the report exited with code 1. All outputs retained 85,997 frames, 1,000 captions, 64 effects plus two excluded effects, six markers, and the earlier strip candidate's `3dd0d93f77ecfbe51fc1589e12906c978e82be06eff17dcfc7fc953dba85873a` output hash. The third output was compared against that candidate's second output because no third earlier run existed.

Maximum RSS intervals were 278.47 / 309.05 / 278.20 ms. Cancellation feedback/readiness was 0.8 / 221.28 ms, with a successful retry. Server peaks grew from 196.55 to 232.31 to 261.02 MiB; renderer peaks grew from 325.64 to 429.06 to 484.36 MiB. This does not prove a leak.

The memory failure stopped expansion to other long conditions. The full matrix did not pass. Human quality, authenticated AI, cache-conditioned performance, and OS-level network blocking remain separate.

## Evidence and related records

- [2026-09-06-windowed-lists-plan.md](../plans/2026-09-06-windowed-lists-plan.md)
- [2026-09-06-windowed-lists-source.json](results/2026-09-06-windowed-lists-source.json)
- [2026-09-06-windowed-lists-apps.json](results/2026-09-06-windowed-lists-apps.json)
- [2026-09-06-windowed-lists-editor.json](results/2026-09-06-windowed-lists-editor.json)
- [2026-09-06-windowed-lists-captions.json](results/2026-09-06-windowed-lists-captions.json)
- [2026-09-06-windowed-lists-general.json](results/2026-09-06-windowed-lists-general.json)
- [2026-09-06-windowed-lists-project-io.json](results/2026-09-06-windowed-lists-project-io.json)
- [2026-09-06-caption-preview-layout.json](results/2026-09-06-caption-preview-layout.json)
- [2026-09-06-caption-preview-layout-diagnostic.json](results/2026-09-06-caption-preview-layout-diagnostic.json)
- [2026-09-06-composition-windowed-smoke.json](results/2026-09-06-composition-windowed-smoke.json)
- [2026-09-06-composition-windowed-smoke-audit.json](results/2026-09-06-composition-windowed-smoke-audit.json)
- [2026-09-06-composition-windowed-long.json](results/2026-09-06-composition-windowed-long.json)
- [2026-09-06-composition-windowed-long-audit.json](results/2026-09-06-composition-windowed-long-audit.json)
- [2026-09-06-composition-windowed-long-third-verification.json](results/2026-09-06-composition-windowed-long-third-verification.json)
- [manual-korean-evaluation.md](manual-korean-evaluation.md)
