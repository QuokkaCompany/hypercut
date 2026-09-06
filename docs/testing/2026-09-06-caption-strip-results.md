# Reducing transparent caption-image work

2026-09-06. Render a common vertical PNG strip containing glyph/background/stroke/antialiasing margins and overlay at original y, with uniform image size and even y/height for 4:2:0 alignment. Preserve source-coordinate layout/fonts/styles/full-canvas samples; empty spans use transparent two-pixel strips. Resolution/CRF/preset/four encoder threads/one input decoder unchanged; earlier 2/1 encoder comparisons were not applied at this stage.

Eight caption tests passed, including 24 PNG pixel comparisons (landscape/portrait × three styles × top/bottom × single/multiline). Restored full RGBA matched full-canvas reference including Korean/Latin/large text/transparency. Empty-span preview matched plain output in every frame. CFR/VFR/PTS/rotation/SAR/ranges/font-error/cancel regressions passed.

80 units and 30 other media/compatibility/frame/effect integrations passed: 28 initially, two FX03 requiring local ports after rerun in permitted environment following `listen EPERM`. These are environment failures, not product defects/approval rejections. Total integrations 38 including eight caption tests; do not count 24 pixel conditions again. Build/package passed with unchanged UI but updated media/worker; unsigned/unnotarized.

## Backend and both-app checks

| Same 60 s condition | Backend RSS MiB | Export/app validation s |
| --- | --- | --- |
| Full-height PNG | 451.359 | 3.524 |
| Vertical strip | 392.203 | 2.889 |

All 1,448 frames/16 captions/16 effects/six markers, sample PNGs and actual MP4 bytes matched, SHA-256 `94136dfb5862ae6a8ae65832ef4f089850c1a0928a9bccb3f93cdcf72a151211`; source/asset unchanged. One backend comparison is not whole-app/long savings.

Candidate `5002212` then passed four 60 s app runs with audited runner/server/bundle/package/project/RSS identities and same bytes/oracles:

| App ×2 | Max RSS GiB | Max action p95 ms | Export s |
| --- | --- | --- | --- |
| Chrome | 1.645 | 101.413 | 3.114–3.115 |
| Mac | 1.067 | 61.321 | 3.093–3.099 |

Caption-preparation cancel Chrome progress 0.45, visible 0.900 ms, ready 304.582 ms; Mac 0.421875,0.800/301.307 ms. Preserve prior project/output/MP4 and complete second composition. Weighted progress is not percent captions complete or video-render cancellation. Max sample interval 284.547 ms.

## Long failure retained

| Browser / 60 min run | Analysis s | Export s | Independent oracle s | RSS GiB | Caption/effect/cut p95 ms |
| --- | --- | --- | --- | --- | --- |
| 1 | 36.743 | 157.127 | 124.084 | 1.946 | 181.008/186.824/66.102 |
| 2 | 37.064 | 157.697 | 124.949 | **2.045 FAIL** | 183.395/199.506/66.497 |

Both 85,997 frames/1,000 captions/64 effects/two excluded clips/six markers, full projects, SRT/MP4 bytes and three sample-frame hashes matched. MP4 SHA-256 `3dd0d93f77ecfbe51fc1589e12906c978e82be06eff17dcfc7fc953dba85873a`; source/asset preserved. No new human listening/visual review implied.

Cancel at caption-preparation 0.3024: visible 0.900/ready 305.256 ms; work preserved and second output completed. Audit every RSS sum and 32 samples/group; max interval 281.237 ms. Faster than 194.064/194.593 s and lower second RSS than 2.146, but still above 2 GiB. At export peak renderer 460.328→522.797 MiB, backend 216.828→240.156, FFmpeg 327.078→325.328; two peaks do not prove a leak. Stop third/other long conditions, retain improvement without claiming repeated-memory resolution.

## Evidence and related records

- [2026-09-06-composition-encoder-comparison.json](results/2026-09-06-composition-encoder-comparison.json)
- [2026-09-06-caption-strip-rendering.json](results/2026-09-06-caption-strip-rendering.json)
- [2026-09-06-composition-caption-strip.json](results/2026-09-06-composition-caption-strip.json)
- [2026-09-06-composition-caption-strip-audit.json](results/2026-09-06-composition-caption-strip-audit.json)
- [2026-09-06-composition-strip-smoke.json](results/2026-09-06-composition-strip-smoke.json)
- [2026-09-06-composition-strip-smoke-audit.json](results/2026-09-06-composition-strip-smoke-audit.json)
- [2026-09-06-composition-strip-long.json](results/2026-09-06-composition-strip-long.json)
- [2026-09-06-composition-strip-long-audit.json](results/2026-09-06-composition-strip-long-audit.json)
- [2026-09-06-composition-strip-long-second-verification.json](results/2026-09-06-composition-strip-long-second-verification.json)
