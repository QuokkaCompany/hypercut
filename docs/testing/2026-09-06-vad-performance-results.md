# VAD performance: initial memory failures

Runs started on September 5 and finished on September 6, 2026, using candidate `0ffdf1a`. All 12 runs and four cancellation/retry conditions completed. Timing and interaction targets passed, but all six browser runs exceeded the 2 GiB RSS limit. The final record is `completed` with `measuredGoalsPass: false` and exit code 1.

| Surface / duration | Analysis median / max (s) | Export median / max (s) | Peak RSS (GiB) | Highest action p95 (ms) |
| --- | --- | --- | --- | --- |
| Chrome / 10 min | 8.371 / 8.449 | 16.236 / 16.249 | **2.066 FAIL** | 67.6 |
| Mac / 10 min | 8.342 / 8.505 | 16.417 / 16.433 | 1.520 | 41.4 |
| Chrome / 60 min | 48.546 / 48.865 | 95.466 / 95.531 | **2.282 FAIL** | 68.2 |
| Mac / 60 min | 49.577 / 49.590 | 96.903 / 97.281 | 1.656 | 57.8 |

Each row contains three repetitions. Analysis includes normal file selection through the editable draft, including VAD, and stayed below 20% of input duration. Export includes full decoding for verification but excludes the final save copy; it stayed below input duration. The 1,152 interactions cover 32 restore, settings, and playback actions per run. Measurements include automation and two animation frames; they do not establish responsiveness during every processing phase.

Browser RSS was 2.013 / 2.053 / 2.066 GiB for 10-minute inputs and 2.191 / 2.227 / 2.282 GiB for 60-minute inputs. Every peak occurred during output. FFmpeg accounted for about 681 MiB in the first 10-minute run and 715 MiB in the first 60-minute run; other app processes were also included. These observations do not establish a single memory cause. Encoder concurrency had not yet been limited.

## Cancellation and output checks

Cancellation occurred during actual VAD. Browser 10-minute cancellation became visible in 1.2 ms and ready for retry in 208.1 ms; Mac: 1.3 / 301.9 ms. Browser 60-minute: 2.4 / 209.3 ms; Mac: 2.3 / 206.4 ms. Server cancellation, the complete saved project, and a successful subsequent run were checked. Visibility means a DOM observation, not a pixel-response measurement.

The actual model generated 39 cuts for 10-minute inputs and 233 for 60-minute inputs. Sample ranges, expected duration, full output decode, and unchanged source hashes passed with no recorded errors.

## Environment and limits

M4 Max, 14 CPU cores, 36 GB RAM, AC power, Darwin 25.5, Node 24.14, FFmpeg 8.1.1, ONNX Runtime 1.29, and Silero 6.2.1 with one intra-op and one inter-op thread. Synthetic Eddy speech was scaled by 0.006 to fall below −40 dBFS; this is not a human-speech quality oracle.

RSS includes the entire Chrome plus server tree, or the Electron tree, and excludes the driver. Shared pages can be counted more than once. Sampling targeted 250 ms, with a maximum observed interval of 281 ms; peaks between samples remain unknown. Apps were newly launched and then reused. OS caches were not purged, and other media/build work did not overlap.

Raw evidence is under `test-output/vad-performance-current`. Short checks with the same identity are separate from the 12 long runs. A fresh smoke command can use `node scripts/vad-benchmark.mjs --durations=60 --iterations=1`; that configuration does not execute the full cancellation matrix.

The later encoder-memory candidate passed a new 12-run matrix. That later result does not erase the failures recorded here. Human recording quality, editing-time savings, authenticated AI, and broader offline/cache conditions remain separate.

## Evidence and related records

- [2026-09-05-vad-performance-plan.md](../plans/2026-09-05-vad-performance-plan.md)
- [2026-09-06-vad-performance-before.json](results/2026-09-06-vad-performance-before.json)
- [2026-09-06-vad-performance-resource-audit.json](results/2026-09-06-vad-performance-resource-audit.json)
- [2026-09-06-vad-performance-smoke.json](results/2026-09-06-vad-performance-smoke.json)
- [2026-09-05-transcription-performance-results.md](2026-09-05-transcription-performance-results.md)
- [2026-09-06-render-memory-results.md](2026-09-06-render-memory-results.md)
