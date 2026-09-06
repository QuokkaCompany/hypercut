# Two encoder threads: composition performance

2026-09-06. Reducing the encoder cap from four threads to two preserved the CRF, preset, output format, frame, caption, and effect settings. The earlier `3d572b4` candidate's third-run RSS failure of 2.008 GiB remains recorded.

## Backend comparison and short app checks

A single 60-second comparison measured 2.938 seconds / 391.828 MiB with four threads and 3.411 seconds / 352.406 MiB with two: approximately 39.42 MiB less memory and 0.47 seconds more time. One pair does not establish a general performance difference. All 16 captions and effects, excluded clips, 1,448 frames and PTS, SRT, and six markers matched. Full frame MD5 and decoded float32 PCM comparisons found no differences.

Compressed output SHA-256 differed: four threads produced `94136dfb5862ae6a8ae65832ef4f089850c1a0928a9bccb3f93cdcf72a151211`; two produced `c189a8273528f4ec8c8587ad414a8fbc4718207a970980f6a477434e7fec9402`.

All 80 unit tests, 38 integration tests, build, and Electron 44.2.0 arm64 packaging passed. The first package attempt failed on sandbox DNS; the permitted-network retry succeeded. This was not an approval rejection. The app remained unsigned.

Candidate `3e6db03` passed two 60-second runs per app:

| Surface | Analysis (s) | Export (s) | RSS (GiB) |
| --- | --- | --- | --- |
| Chrome | 1.063 / 1.065 | 3.745 / 3.730 | 1.515 / 1.595 |
| Mac | 1.269 / 1.121 | 3.701 / 3.781 | 0.931 / 1.031 |

All actual MP4 files matched the two-thread backend hash, linking them to its complete frame/PCM comparison without counting duplicate decodes as new checks. Each interaction group contained 32 actions and stayed below 200 ms p95. Maximum RSS sample interval was 282.88 ms. Caption-preparation cancellation became visible in 0.8 ms; readiness took 304.96 / 300.91 ms. Subsequent runs completed.

## Long composition matrix

| Surface / duration / run | Analysis (s) | Export (s) | Oracle (s) | RSS (GiB) |
| --- | --- | --- | --- | --- |
| Chrome / 60 min / 1 | 37.291 | 187.915 | 125.534 | 1.752 |
| Chrome / 60 min / 2 | 37.074 | 187.852 | 125.211 | 1.890 |
| Chrome / 60 min / 3 | 37.287 | 187.572 | 125.509 | 1.956 |
| Mac / 60 min / 1 | 37.270 | 192.669 | 126.211 | 1.161 |
| Mac / 60 min / 2 | 36.596 | 190.543 | 131.930 | 1.097 |
| Mac / 60 min / 3 | 36.552 | 192.669 | 127.613 | 1.099 |
| Chrome / 10 min / 1 | 6.741 | 32.818 | — | 1.647 |
| Chrome / 10 min / 2 | 6.515 | 32.823 | — | 1.707 |
| Chrome / 10 min / 3 | 6.551 | 32.833 | — | 1.728 |
| Mac / 10 min / 1 | 6.455 | 32.189 | — | 1.082 |
| Mac / 10 min / 2 | 6.260 | 32.182 | — | 1.144 |
| Mac / 10 min / 3 | 6.577 | 33.399 | — | 1.164 |

All six 60-minute outputs contained 85,997 frames, 1,000 SRT cues, 64 effects plus two excluded effects, and six markers. They shared SHA-256 `a1a18a4b7a55fd9615c8e848e5aa6dc61f2ead2177d22ff79ceb5d92cb08e74e`. All 85,997 decoded YUV420p frame hashes, PTS, durations, and decoded PCM samples matched the earlier four-thread output; identical compressed files were decoded once for this equivalence comparison. Three Korean caption frames were viewed, which does not establish every glyph or human listening quality.

Earlier four-thread browser exports took 156.985 / 158.026 / 160.405 seconds; the new median was 29.83 seconds slower. The third browser run had only 45.17 MiB of RSS headroom, so the passing result does not eliminate concern about repeated growth. Maximum sampling intervals were 363.44 ms in Chrome and 316.39 ms on Mac. Highest action p95 was 120.17 / 60.28 ms. Cancellation feedback/readiness was 0.8 / 224.12 ms in Chrome and 0.8 / 205.88 ms on Mac, followed by completed retries.

All six 10-minute outputs contained 14,348 frames, 166 SRT cues, 64 effects plus two excluded effects, and six markers, with SHA-256 `cf4164f895c2010432d6b13e839b4ad8cad800ae9fbd94d351487942dcd23af1`. No four-thread 10-minute comparison is claimed. Maximum sample interval was 284.03 ms; highest action p95 was 117.91 ms in Chrome and 64.74 ms on Mac. Cancellation feedback was 0.8 ms and readiness 199.03 / 204.81 ms, followed by successful retries.

The audit accepted a valid report and rejected five altered controls: lowered RSS, lowered p95, changed project, bad hash, and missing repetition. These six audit controls are not product runs.

All 12 long runs and four cancellation/retry conditions passed, separately from four short runs, with fixed candidate identity and maximum RSS of 1.956 GiB. Human Korean quality/CER/editing time, authenticated AI, cache-conditioned performance, and Mac OS-level network blocking remain separate. A local prerequisite probe found no Ollama on PATH and a refused connection at port 11434; that does not prove no installation exists elsewhere, and no model download or authenticated request was performed.

## Evidence and related records

- [2026-09-06-encoder-concurrency-plan.md](../plans/2026-09-06-encoder-concurrency-plan.md)
- [2026-09-06-windowed-encoder-four.json](results/2026-09-06-windowed-encoder-four.json)
- [2026-09-06-windowed-encoder-two.json](results/2026-09-06-windowed-encoder-two.json)
- [2026-09-06-windowed-encoder-comparison.json](results/2026-09-06-windowed-encoder-comparison.json)
- [2026-09-06-encoder-two-regressions.json](results/2026-09-06-encoder-two-regressions.json)
- [2026-09-06-composition-encoder-two-smoke.json](results/2026-09-06-composition-encoder-two-smoke.json)
- [2026-09-06-composition-encoder-two-smoke-audit.json](results/2026-09-06-composition-encoder-two-smoke-audit.json)
- [2026-09-06-composition-encoder-two-smoke-decoding.json](results/2026-09-06-composition-encoder-two-smoke-decoding.json)
- [2026-09-06-composition-encoder-two-browser-3600.json](results/2026-09-06-composition-encoder-two-browser-3600.json)
- [2026-09-06-composition-encoder-two-browser-3600-audit.json](results/2026-09-06-composition-encoder-two-browser-3600-audit.json)
- [2026-09-06-composition-encoder-two-browser-3600-visual.json](results/2026-09-06-composition-encoder-two-browser-3600-visual.json)
- [2026-09-06-composition-encoder-two-browser-3600-decoding.json](results/2026-09-06-composition-encoder-two-browser-3600-decoding.json)
- [2026-09-06-composition-audit-controls.json](results/2026-09-06-composition-audit-controls.json)
- [2026-09-06-composition-encoder-two-both-600.json](results/2026-09-06-composition-encoder-two-both-600.json)
- [2026-09-06-composition-encoder-two-both-600-audit.json](results/2026-09-06-composition-encoder-two-both-600-audit.json)
- [2026-09-06-composition-encoder-two-both-600-cross-surface.json](results/2026-09-06-composition-encoder-two-both-600-cross-surface.json)
- [2026-09-06-composition-encoder-two-both-600-visual.json](results/2026-09-06-composition-encoder-two-both-600-visual.json)
- [2026-09-06-composition-encoder-two-desktop-3600.json](results/2026-09-06-composition-encoder-two-desktop-3600.json)
- [2026-09-06-composition-encoder-two-desktop-3600-audit.json](results/2026-09-06-composition-encoder-two-desktop-3600-audit.json)
- [2026-09-06-composition-encoder-two-desktop-3600-decoding.json](results/2026-09-06-composition-encoder-two-desktop-3600-decoding.json)
- [2026-09-06-composition-encoder-two-matrix.json](results/2026-09-06-composition-encoder-two-matrix.json)
- [2026-09-06-cache-verification-plan.md](../plans/2026-09-06-cache-verification-plan.md)
- [2026-09-06-local-ai-prerequisites.json](results/2026-09-06-local-ai-prerequisites.json)
