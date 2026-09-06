# Local speech-protection results — 2026-09-05

After `0a5f98e`, optional default-off VAD subtracts detected speech from amplitude candidates, displays extra preserved time/segments, supports source seeking and reanalysis prompts. Real Silero/TTS/multichannel/output and both-app checks passed; **human Korean Q01–Q05 remained NOT_RUN**. Energy preservation does not prove zero clipped syllables.

Environment: M 4 Max/macOS arm 64, Node 24.14.1/Electron 44.2.0/FFmpeg 8.1.1/ONNX Node 1.29.0. Bundled Silero 6.2.1 commit `7e30209a3e901f9842f81b225f3e93d8199902b1 `, 2,327,524-byte ONNX, SHA-256 ` 1a153a22f4509e292a94e67d6f9b85e8deb25b4988682b7e174c65279d8788e3`, MIT. Verify hash per model session; errors never silently disable protection.

Source-aligned 16 kHz PCM uses independent per-channel state, 512-sample windows/64-sample context. No averaging/phase cancellation; analysis-only gain capped 100×, original output volume. Apply existing min/padding/frame rules after protection subtraction. Set `ORT_DISABLE_TELEMETRY=1` before initialization; separate this configuration from actual OS-block evidence. Windows/Linux packages untested.

Checks: 37 units, eight media, 11 API, five VAD (four initially plus one real in-progress cancel). With 22 retained earlier compatibility/failure/ENOSPC/CLI checks, historical total of 83 PASS; those 22 were not rerun after this change. Package/both-app VAD E2E/core E2E/browser offline separate; core E2E preceded final ONNX unpack correction.

## Actual media and cancellation

Installed Korean Eddy TTS repeated twice with three-second middle silence, PCM peak≈0.004,17.7-second MP4. Default−40 dBFS removes all without VAD; probability 0.5 protection:

| Input | Output seconds | Independent original-PCM energy retained | Output peak |
| --- | --- | --- | --- |
| Mono / 48 kHz | 11.466667 | 100% | ≈0.003999 |
| Right-only / 48 kHz | 11.466667 | 100% | ≈0.003999 |
| Opposite-phase stereo / 44.1 kHz/+3 sPTS | 11.433267 | 100% | ≈0.004006 |

Middle pause removed, full decode/source hashes passed. Independent PCM energy versus actual removals was used, not VAD output as its own oracle; listening quality remains separate.

Both apps exercised all-removed→protection→reanalyze→seek speech→encoded preview→save, v2 round trip and v1 migration preserving cuts/default-off. 390 pxcontrols passed; native paths substituted. Real 180-second VAD canceled at≈55.69% with 2.59 ms API response, no result, followed by successful short analysis. Single API latency, not UI/p95. Model session recreation/final short window also checked.

OS non-loopback blocking covered Chrome/server/children after TEST-NET probe EPERM; zero external page requests. Mac same condition NOT_RUN due nested sandbox; app security unchanged.

## Failures fixed and limits

Unbounded fixture padding produced a large temporary PCM; stop only identified test process/remove its file, replace with exact-sample construction and decoded-size bounds (final folder≈5 MiB). Browser success did not catch native missing dylib: unpack native library and companion dylib into app.asar.unpacked, retain only target-platform binaries, then actual Mac passed. Runner cleanup recorded failures before closing only its processes, preserving unsaved prompts; project assertions now wait for async reads.

Real/noisy/music-mixed recordings, long VAD/cold-cache, clean-machine distribution and all model-error UI/native offline combinations remained unverified. Named S01–S05 and S06/S07 subconditions passed, not full product acceptance. STT/captions/effects/actual LLMs were subsequent work.

## Evidence and related records

- [2026-09-05-speech-protection-plan.md](../plans/2026-09-05-speech-protection-plan.md)
- [silero-vad.json](../../assets/models/silero-vad.json)
- [utils_vad.py](https://github.com/snakers4/silero-vad/blob/v6.2.1/src/silero_vad/utils_vad.py)
- [Privacy.md](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md)
- [2026-09-05-speech-media.json](results/2026-09-05-speech-media.json)
- [2026-09-05-speech-ui.json](results/2026-09-05-speech-ui.json)
- [2026-09-05-speech-cancellation.json](results/2026-09-05-speech-cancellation.json)
- [2026-09-05-speech-offline.json](results/2026-09-05-speech-offline.json)
