# Local speech protection implementation and validation

Implement optional VAD without changing amplitude-only editing. Detected speech is removed from deletion candidates. This is separate from transcription and does not guarantee every word or phoneme.

## Contract

Default off; preserve the setting and detection threshold in projects. dBFS remains the amplitude criterion. The separate speech probability threshold is 0.1–0.9, default 0.5; lower values preserve more detected speech.

Resample the selected track to 16 kHz aligned to source time. Analyze up to eight channels independently with separate model state, preserving the union. Do not average away opposite-phase speech. Amplify analysis input only toward peak 0.5, capped at 100×. Source/output volume remains unchanged; this cannot reliably recover all quiet speech amid loud noise.

Collect 32 ms windows at or above probability threshold, merge gaps up to 160 ms, retain short syllables without a minimum-speech filter, and pad one window on both sides. Subtract protection from amplitude candidates, then apply minimum silence, speech padding, and inward frame snapping. Protection must never increase removed duration.

Changed settings require reanalysis. Failure/cancellation preserves prior cuts/restorations/projects. Missing/corrupt models or inference failure must not silently disable protection. Bundle pinned Silero VAD v6.2.1, SHA-256, and MIT license; run on local CPU without inference-time downloads or accounts.

`server/vad.mjs` owns inference, `shared/speech.mjs` interval protection, and `shared/speech-settings.mjs` validation. Existing AI proposals still modify only their four silence settings. Project v2 requires speech-protection settings; v1 migrates to off. Old v1 apps are not declared compatible with v2.

## Cases

| ID | Test | Pass criterion |
| --- | --- | --- |
| S01 | Subtraction, monotonicity, frames, minimum duration | Independent expected intervals; no protected deletion or increased removal |
| S02 | Probability boundaries, channels, short syllables, final window | Correct threshold/union; reject empty/NaN outputs |
| S03 | Real ONNX and Korean TTS | Preserve known speech interior, remove long middle pause, fully decode output |
| S04 | Left/right-only, opposite phase, 44.1 kHz, PTS offset | Same source-time speech preserved without downmix cancellation |
| S05 | v1→v2, round trip, setting change | Preserve cuts/settings and show reanalysis need |
| S06 | Cancel, corrupt model, failed analysis | Preserve cuts, retry, no silent fallback |
| S07 | Browser and packaged Mac | Settings/analyze/preview/save/export without external requests/UI errors |

TTS tests real inference mechanics, not human Q01–Q05. Actual recording accuracy and long performance remain separate. Sources: [Silero](https://github.com/snakers4/silero-vad/tree/v6.2.1), [state/context wrapper](https://github.com/snakers4/silero-vad/blob/v6.2.1/src/silero_vad/utils_vad.py), [ONNX Node](https://onnxruntime.ai/docs/get-started/with-javascript/node.html).

See [performance plan](2026-09-05-vad-performance-plan.md), [initial 12-run results](../testing/2026-09-06-vad-performance-results.md), and [render-memory follow-up](../testing/2026-09-06-render-memory-results.md). Initial browser RSS exceeded 2 GiB; the later same-condition matrix met targets. Neither establishes real-recording or cold-cache acceptance.
