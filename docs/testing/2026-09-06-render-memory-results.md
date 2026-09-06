# Encoder concurrency: VAD memory improvement

2026-09-06. Limiting encoder concurrency to at most four CPU threads with `-threads:v` allowed all 12 VAD runs and four cancellation/retry conditions to pass the measured targets. Other quality settings were unchanged. Earlier failures remain recorded in the VAD performance report.

| Surface / duration | Previous → new peak RSS (GiB) | Previous → new export median (s) | New export max (s) |
| --- | --- | --- | --- |
| Chrome / 10 min | 2.066 → 1.795 | 16.236 → 24.666 | 24.675 |
| Mac / 10 min | 1.520 → 1.205 | 16.417 → 24.939 | 24.955 |
| Chrome / 60 min | 2.282 → 1.977 | 95.466 → 146.740 | 146.960 |
| Mac / 60 min | 1.656 → 1.397 | 96.903 → 147.372 | 147.377 |

Each condition has three repetitions. Export time includes verification decoding and excludes the final file copy. Median export time increased approximately 51–54%. Unchanged quality settings alone do not prove compressed-byte or perceptual equivalence. In the first browser 60-minute run, FFmpeg peak memory fell from about 715 to 404 MiB; this does not attribute all process-tree memory to the encoder.

| Surface / duration | Analysis median / max (s) | Highest action p95 (ms) | Retry readiness (ms) |
| --- | --- | --- | --- |
| Chrome / 10 min | 8.349 / 8.813 | 68.1 | 210.0 |
| Mac / 10 min | 8.735 / 8.791 | 40.3 | 209.1 |
| Chrome / 60 min | 48.583 / 48.930 | 67.8 | 206.0 |
| Mac / 60 min | 49.598 / 49.652 | 59.4 | 277.5 |

Analysis covers file selection through the editable draft and stayed below 20% of source duration. All 1,152 measured interactions stayed below 200 ms p95. They include automation and two animation frames and do not cover every busy phase. Actual VAD cancellation became visible in 1.3–2.5 ms; the server acknowledged cancellation, complete projects were preserved, and the next runs completed. DOM timing is not a pixel-response measurement.

## Correctness and reproducibility

All 12 analysis JSON results matched the earlier candidate, including waveform, amplitude, and VAD data: 39 cuts for 10-minute inputs and 233 for 60-minute inputs. Complete projects matched after excluding save timestamps. Source hashes, output duration, and full decoding passed.

Validation also passed 75 unit tests, 28 integration tests, and six flows across both apps, including actual TTS/Whisper transcription but no LLM requests. Build and packaging passed. One 10-minute probe is recorded separately from the formal matrix.

The machine was an M4 Max with 14 CPU cores and 36 GB RAM on AC power, Darwin 25.5, Node 24.14, and FFmpeg 8.1.1. The Silero model, inputs, and runner were unchanged. Apps were newly launched and then reused; OS caches were not purged, and no other media/build work overlapped. RSS sampling targeted 250 ms with a 280 ms maximum interval. Shared-page duplication and unobserved peaks between samples remain limitations.

The source base was `7b08c8e` with uncommitted encoder changes. Recorded source hashes identify the actual candidate; only media/package files differed, while the model, runner, and inputs matched. All three run folders exited successfully. Use a fresh evidence directory:

```sh
node scripts/vad-benchmark.mjs --output=test-output/FRESH_RUN_NAME
```

Threshold mode with 1,000 cuts, long caption/effect composition, OS-wide cold caches, human Korean quality/CER/editing time, native offline operation, and authenticated AI require their own evidence.

## Evidence and related records

- [2026-09-06-render-memory-plan.md](../plans/2026-09-06-render-memory-plan.md)
- [2026-09-06-vad-performance-results.md](2026-09-06-vad-performance-results.md)
- [2026-09-06-render-memory-browser-long.json](results/2026-09-06-render-memory-browser-long.json)
- [2026-09-06-render-memory-ten-minute.json](results/2026-09-06-render-memory-ten-minute.json)
- [2026-09-06-render-memory-mac-long.json](results/2026-09-06-render-memory-mac-long.json)
- [2026-09-06-render-memory-audit.json](results/2026-09-06-render-memory-audit.json)
- [2026-09-06-render-memory-regressions.json](results/2026-09-06-render-memory-regressions.json)
- [2026-09-06-render-memory-probe.json](results/2026-09-06-render-memory-probe.json)
