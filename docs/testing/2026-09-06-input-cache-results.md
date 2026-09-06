# Input-file cache measurements for composition

2026-09-06. After the completed encoder matrix, a runner-only controller added observed input-file cache conditions. It uses `F_NOCACHE_EXT` and fresh, byte-identical copies. Cold inputs must have zero resident pages immediately before selection; warm inputs must have all pages resident. A failed observation fails the run rather than relabeling it. The default remains uncontrolled.

Preparation and inspection are timed separately. Product analysis still includes ordinary file selection, upload, decoding, waveform/frame indexing, and draft creation. Hashes are checked after analysis and again after all work, without pre-reading the measured file. Native clock, compiler, tool, and source hashes are recorded. These conditions do not establish OS-wide, storage-device, or internal-copy cache state.

## Controller and short checks

Nine controller checks passed using actual files: cold/warm preparation, premature reads, existing-file collisions, forbidden pre-hashing, changed inputs after analysis or all work, and invalid page counts.

| 60-second condition | Runs across both apps | Maximum RSS (GiB) | Resident pages |
| --- | --- | --- | --- |
| Uncontrolled baseline | 4 | 1.511 | Not constrained |
| Cold | 4 | 1.425 | 0 / 74 |
| Warm | 4 | 1.593 | 74 / 74 |

Each input was 1,207,118 bytes with 16 KiB pages. Inspection-to-selection delays were 0.24–0.38 ms cold and 0.33–0.37 ms warm. Preparation took 3.13–158.60 ms cold and 6.07–167.41 ms warm.

All 12 MP4 outputs matched SHA-256 `c189a8273528f4ec8c8587ad414a8fbc4718207a970980f6a477434e7fec9402`: 1,448 frames, 16 captions/effects, excluded clips, six markers, SRT, and complete projects matched. Full-frame/PCM equivalence is inherited through identical output bytes, not counted as new independent decodes. Highest action p95 was 100.63 ms, maximum RSS sample interval 318.48 ms, and cancellation feedback/readiness at most 1.3 / 308.12 ms. Subsequent runs completed. The preparation driver is excluded from app RSS.

## Browser 60-minute checks

Inputs contained 71,258,047 bytes and 4,350 pages. Every cold repetition had 0 / 4,350 resident pages; every warm repetition had 4,350 / 4,350.

| Condition / run | Analysis (s) | Export (s) | Oracle (s) | RSS (GiB) |
| --- | --- | --- | --- | --- |
| Cold / 1 | 38.022 | 191.863 | 125.804 | 1.484 |
| Cold / 2 | 37.620 | 190.611 | 129.158 | 1.561 |
| Cold / 3 | 37.846 | 192.477 | 129.156 | 1.590 |
| Warm / 1 | 37.262 | 188.763 | 124.799 | 1.738 |
| Warm / 2 | 38.859 | 188.542 | 128.507 | 1.668 |
| Warm / 3 | 39.462 | 194.895 | 127.893 | 1.542 |

Cold inspection-to-selection delay was 0.272–0.339 ms, with preparation taking 19.99–208.81 ms. Warm delay was 0.249–0.372 ms, with preparation taking 50.70–210.24 ms. Product and runner identities remained fixed.

All six outputs matched the encoder candidate's 85,997-frame output hash `a1a18a4b7a55fd9615c8e848e5aa6dc61f2ead2177d22ff79ceb5d92cb08e74e`, project, and SRT/oracle checks. Maximum RSS sample intervals were 345.17 ms cold and 349.69 ms warm. All 32-action groups stayed below 200 ms p95; the warm maximum was 117.85 ms. Cold cancellation feedback/readiness was 0.8 / 210.12 ms; warm was 0.9 / 201.83 ms, with successful retries.

Six of 24 planned long composition runs completed; the remaining 18 are `NOT_RUN`. Threshold mode has a separate matrix. These observations do not establish a general cold/warm speed difference, human quality, authenticated AI, OS-level offline behavior, or an entirely cold OS cache.

## Evidence and related records

- [2026-09-06-cache-verification-plan.md](../plans/2026-09-06-cache-verification-plan.md)
- [2026-09-06-encoder-two-results.md](2026-09-06-encoder-two-results.md)
- [2026-09-06-file-cache-controller.json](results/2026-09-06-file-cache-controller.json)
- [2026-09-06-input-cache-smoke-summary.json](results/2026-09-06-input-cache-smoke-summary.json)
- [2026-09-06-input-cache-smoke-uncontrolled.json](results/2026-09-06-input-cache-smoke-uncontrolled.json)
- [2026-09-06-input-cache-smoke-uncontrolled-audit.json](results/2026-09-06-input-cache-smoke-uncontrolled-audit.json)
- [2026-09-06-input-cache-smoke-cold.json](results/2026-09-06-input-cache-smoke-cold.json)
- [2026-09-06-input-cache-smoke-cold-audit.json](results/2026-09-06-input-cache-smoke-cold-audit.json)
- [2026-09-06-input-cache-smoke-warm.json](results/2026-09-06-input-cache-smoke-warm.json)
- [2026-09-06-input-cache-smoke-warm-audit.json](results/2026-09-06-input-cache-smoke-warm-audit.json)
- [2026-09-06-input-cache-browser-3600-cold.json](results/2026-09-06-input-cache-browser-3600-cold.json)
- [2026-09-06-input-cache-browser-3600-cold-audit.json](results/2026-09-06-input-cache-browser-3600-cold-audit.json)
- [2026-09-06-input-cache-browser-3600-warm.json](results/2026-09-06-input-cache-browser-3600-warm.json)
- [2026-09-06-input-cache-browser-3600-warm-audit.json](results/2026-09-06-input-cache-browser-3600-warm-audit.json)
- [2026-09-06-input-cache-long-matrix.json](results/2026-09-06-input-cache-long-matrix.json)
- [2026-09-06-thousand-cut-performance-plan.md](../plans/2026-09-06-thousand-cut-performance-plan.md)
