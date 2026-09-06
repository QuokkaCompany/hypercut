# Selected-range preview verification — 2026-09-05

Both apps gained an encoded selected-cut preview, defaulting to two source seconds either side, editable and played in a separate dialog without replacing main playback/export state. Expand the requested outer range to complete frames while retaining full-output internal cut boundaries. Exclude outside fragments even below the automatic 100 ms minimum without editing project cuts. An all-removed range errors with retry.

Build the source frame index once, then seek shortly before the requested region and trim preserved source timestamps. Decoding a large included silence range still costs time; no universal instant-preview claim.

Checks rerun: 30 units, eight media, nine API, ten compatibility; package, new/core both-app E2E, long-range oracle PASS. With nine older atomic/failure/ENOSPC checks retained, historical total 66; distinguish those not rerun. Native paths substituted. A native close/Playwright dialog conflict was fixed by saving test projects before cleanup, not altering product prompts. At 390 px, inspect actual modal bounds/close clicks rather than page width alone.

16-second sample source `[2,6)` preview yielded 2.266667 s with its cut or four seconds after restore. Full export remained unchanged; failed preview preserved existing output; dialog arrow keys did not seek the background player.

## Timing and long-source evidence

Initial input seeking lost a marker on +3 s PTS input despite passing full exports. Disable automatic accurate input seeking and apply video trim/audio resampler start samples against preserved timestamps. Earlier keyframes are allowed for decoding but filters define final range/cuts. Verify actual output against the linked FFmpeg contracts.

CFR/VFR/+3 PTS preview `[2.4,7)` with cut `[4.2,5.2)` yielded 3.6 s and 172,800 pre-encode samples; flashes 0.6/2.6 s, beeps within 0.7 ms, no inherited cumulative offset. Subframe `[2.01,2.02)` yielded one complete frame. Source six seconds/audio ends at one second, 44.1k, preview `[4,5)` yielded one second with silent audio.

On M4 Max/36 GiB/FFmpeg8.1.1, reuse synthetic 1080p30 H.264/AAC48k 60-minute input. Inspection/hash/frame index/1,000-cut analysis took 32.981 s separately. Source 59:50–59:59 (nine seconds) became about 7.533 s.

| Run | Generation/full decode seconds | Maximum additional marker error |
| --- | --- | --- |
| 1 | 0.281 | 0.254 ms |
| 2 | 0.273 | 0.254 ms |
| 3 | 0.275 | 0.254 ms |

Median 0.275 s measures a prepared frame-index/cache engine call, excluding selection/initial analysis/UI, app RSS, or speech quality. No concurrent media tests. M06 listening, Q01–Q05 human quality/time, real AI, and other unverified gates remain outstanding.

## Evidence and related records

- [2026-09-05-range-preview-ui.json](results/2026-09-05-range-preview-ui.json)
- [ffmpeg.html](https://ffmpeg.org/ffmpeg.html#Advanced-options)
- [ffmpeg-resampler.html](https://ffmpeg.org/ffmpeg-resampler.html#Resampler-Options)
- [2026-09-05-range-preview-long.json](results/2026-09-05-range-preview-long.json)
