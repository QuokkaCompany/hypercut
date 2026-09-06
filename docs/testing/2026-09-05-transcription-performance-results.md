# Long transcription performance results

Executed September 5, 2026, America/New_York. The same `1e927ff` app/model completed 10/60-minute inputs across Chrome/Mac with three repetitions: 12 runs plus four cancellation/re-request conditions. Measured transcription timing, RSS, and caption-selection targets passed. This does not establish human quality, every interaction, the full T07/G3 gate, or release readiness.

## Completed v7 measurements

| App / input | Runs | Inference workflow (s) | Maximum process-tree RSS (GiB) | Highest selection p95 (ms) |
| --- | --- | --- | --- | --- |
| Chrome / 10 min | 3 | 40.897–42.963 | 2.184 | 14.4 |
| Mac / 10 min | 3 | 40.885–41.563 | 1.690 | 7.6 |
| Chrome / 60 min | 3 | 227.798–229.417 | 2.746 | 14.1 |
| Mac / 60 min | 3 | 234.371–243.186 | 2.245 | 11.5 |

Ten-minute medians were 41.897 seconds in Chrome and 41.018 on Mac; 60-minute medians were 228.788 and 242.450 seconds. Each 10-minute input produced 98 cues; each 60-minute input produced 580 with one end-review warning. No page, external-request, or RSS-sampling errors were recorded. Three duration samples do not support a duration p95.

The first v7 report remains `failed`: nine completed runs were followed by a Mac 60-minute run with server completion but 36 click samples instead of 32. That run is excluded. The original runner kept collecting after 32 without provenance for the extra four; their cause was not established. The fix assigns sequence/target IDs, closes measurement after 32, and separately records outside clicks. It still rejects extras within the window, wrong ordering, unapplied selection, and samples outside inference. Chrome controls verified both outside-click separation and in-window rejection.

A new short smoke completed in 4.340 seconds in Chrome and 4.631 on Mac, with 32 samples each, no outside clicks, cancellation/re-request, and the same package hash. Runner fix `c7ec545` then completed three Mac 60-minute runs in a fresh folder, each with 32 samples and no extras. Product/model identity was unchanged; runner identities remain separate, and the accepted total is explicitly nine plus three.

```sh
node scripts/transcription-benchmark.mjs --durations=3600 --surfaces=desktop --iterations=3 --output=test-output/FRESH_MAC_RUN
```

| Condition | Visible cancellation (ms) | Retry readiness (ms) |
| --- | --- | --- |
| Chrome / 10 min | 1.2 | 63.9 |
| Mac / 10 min | 1.8 | 354.2 |
| Chrome / 60 min | 1.8 | 199.4 |
| Mac / 60 min | 2.6 | 201.8 |

All met the 300 ms feedback and five-second readiness targets. Actual Whisper exit, current-text preservation, and a new request entering inference were checked. These checks do not prove full retry completion or bitwise preservation of the entire project.

## Inputs, measurement, and historical runs

M4 Max with 14 cores and 36 GiB RAM, Darwin 25.5 arm64, AC power, with other apps open. Whisper small multilingual / 1.9.3-dev used four CPU threads, Metal disabled, and mono Korean input. JSON records preserve model hashes, repeated Eddy TTS text, period, and media hashes. Simple 1080p/30 fps H.264 with 48 kHz AAC is not representative of human, noisy, or complex footage. Each condition began with a fresh app and reused that process twice; OS caches were not purged.

Workflow timing starts at the transcription request and includes model checks, audio preparation, inference, and results; import is separate. RSS samples cover Chrome plus server, or the full Electron tree, every 250 ms, excluding the driver. Peaks between samples are unknown. The 32 caption selections measure actual event, state update, and next frame, not every UI control.

| Pre-fix 10-minute app | Runs (s) | Median (s) | Maximum RSS (GiB) | Highest selection p95 (ms) |
| --- | --- | --- | --- | --- |
| Chrome | 39.482 / 39.103 / 39.116 | 39.116 | 2.430 | 14.7 |
| Mac | 39.420 / 39.105 / 39.098 | 39.105 | 1.779 | 9.1 |

Those six runs met the 600-second / 4 GiB / 200 ms targets with 98 valid cues, without establishing accuracy. Original cancellation feedback/readiness was 0.9 / 153.7 ms in Chrome and 2.0 / 61.3 ms on Mac; a new inference started and was cancelled. The 71 unit tests included two resource-tree/quantile controls. Initial 60-second smoke measurements were approximately 4.323 seconds / 2.098 GiB in Chrome and 4.705 seconds / 1.591 GiB on Mac, with 32 actions and cancellation/re-request.

An initial repeated AAC-cycle fixture drifted to approximately 29.989 fps. Repeating video and PCM separately before AAC encoding restored the required 30 fps. The first 60-minute inference failed on a 240 ms final-cue overflow despite exactly 3,600 seconds of PCM; that failure and the end-review fix remain separate records.

The completed 12-run matrix does not resolve human CER/timing/active time, OS-wide cold caches, all controls, VAD/composition performance, remaining native OS/offline conditions, or authenticated models.

## Evidence and related records

- [2026-09-05-transcription-performance-plan.md](../plans/2026-09-05-transcription-performance-plan.md)
- [2026-09-05-transcription-performance-v7-partial.json](results/2026-09-05-transcription-performance-v7-partial.json)
- [2026-09-05-transcription-performance-v7-mac.json](results/2026-09-05-transcription-performance-v7-mac.json)
- [2026-09-05-transcription-selection-smoke.json](results/2026-09-05-transcription-selection-smoke.json)
