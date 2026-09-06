# Local transcription and caption editing results

This historical v3 record was executed on September 5, 2026, after `47373e5`. Later caption-design/v4 and model-download recovery work has separate records. Features described here as unimplemented refer only to this stage. This is not complete MVP or human Korean accuracy acceptance.

Both apps supported import, language/channel selection, actual Whisper inference, source captions, text/timing editing, cut review, edited SRT, and v3 project restoration. Delete, undo/redo, and protection of unapplied input were checked. Source times are stored; SRT uses the same frame-aligned retained ranges as MP4. Partially cut sentences appear once and require review. Changes to text, timing, or cuts invalidate that review. Fully removed cues disappear and return when cuts are restored. At this stage source VTT worked, while styled MP4, AI correction, and effects were unimplemented; the UI stated that video output had no burned-in captions.

## Runtime and checks

Pinned whisper.cpp commit `371b5a7561823ab2bb32142d2751e35e7534727b` (`b4938`), CLI 1.9.3-dev; archive SHA-256 `89051d8fca516a3ad1f5c2f8f9d2fccb089afbaec338fca3f8731999babc6f81`. The multilingual small model is 487,601,967 bytes with SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.

Inference uses Apple Silicon CPU/Accelerate, four threads, and no Metal. The selected channel becomes 16 kHz, 16-bit mono WAV without volume adjustment. Each inference verifies the model hash; status, size, and version alone are not successful inference. Failure or cancellation preserves cuts/captions and never triggers a cloud fallback.

Project-local setup downloads, builds, verifies, and reuses the runtime. The downloaded model is excluded from Git and packaged under `Resources/transcription` with its executable and licenses. The package was approximately 902 MiB at this stage and required external FFmpeg. Signing, notarization, other OSes, and complete download/install recovery were unverified.

All 42 unit tests, four actual-transcription integrations, 11 API checks, and eight media checks passed: 65 automated checks. Build, packaging, caption/core E2E in both apps, and browser OS-offline checks were separate. The native package retained sandboxing, context isolation, and disabled Node integration. The runner supplied native paths. Mac OS-level network blocking was `NOT_RUN` because of nested sandbox constraints; security settings were not weakened.

## Actual model and output

A 17.7-second Korean Eddy TTS recording, repeated twice, exercised low volume, right-channel-only audio, and 44.1 kHz opposite-phase audio with a +3-second PTS offset. Source hashes remained unchanged and cues stayed in range. The model misrecognized a Korean word for silence and placed the first cue at zero before speech began. Manual correction and review were required; returned text did not establish T02 accuracy or timing quality.

Both apps produced the following corrected SRT mapping:

| Source seconds | Edited seconds |
| --- | --- |
| 1.100–6.700 | 0.167–5.467 |
| 10.500–16.050 | 5.933–11.217 |

These values depend on this fixture and its VAD settings. An independent fixed mapping also checked that `[5, 6.2)` after an earlier two-second cut becomes `[3, 4.2)`, including partial-review invalidation, deletion, and restoration. Korean text, playback, layout, and 390 px screens were viewed. Shared modal CSS initially overrode caption width; adjusting style priority and background sizing fixed it, followed by reruns in both apps.

## Remaining scope at this stage

T01/T03/T04 have actual model, channel, PTS, cancellation, and retry evidence, but not every language, VFR, track, setup, decode, or write failure. T05 rejected missing and same-sized corrupt models, while installation recovery remained incomplete. T06's dedicated stale-response/media/language races were incomplete. T02/T07 human CER, timing, active time, and long performance remained `NOT_RUN`.

C01–C04 covered the named mapping, editing, migration, and undo conditions without styling. C05/C06/C09/C10 covered SRT, source playback, and text editing, not design rendering, portrait layout, or font failures. C07/C08 and FX01–FX05 were unimplemented. Later records advance only their specified conditions. Logs and captures are under `test-output/transcription-*` and `captions-*`; large media are excluded from Git.

## Evidence and related records

- [2026-09-05-caption-rendering-results.md](2026-09-05-caption-rendering-results.md)
- [2026-09-06-model-download-recovery-results.md](2026-09-06-model-download-recovery-results.md)
- [whisper-small.json](../../assets/models/whisper-small.json)
- [2026-09-05-transcription-media.json](results/2026-09-05-transcription-media.json)
- [2026-09-05-captions-ui.json](results/2026-09-05-captions-ui.json)
- [2026-09-05-captions-offline.json](results/2026-09-05-captions-offline.json)
