# HyperCut MVP validation plan

Created: 2026-09-05. Clarified: 2026-09-06 (cost checks, gates, and artifact identity). This is a specification, not a report of passing tests.

Related: [product design](../superpowers/specs/2026-09-05-hypercut-silence-first-design.md), [test cases](2026-09-05-test-plan.md), [plan index](README.md), and [execution status](../testing/README.md).

## Validation objectives

| ID | Question |
| --- | --- |
| V1 | Do detected intervals and edits implement the threshold, duration, padding, and frame rules? |
| V2 | Does the output preserve speech, including quiet syllables and word endings? |
| V3 | Do video and audio remain synchronized after many cuts? |
| V4 | Do edits and completed files survive cancellation, errors, and stale responses? |
| V5 | Does review plus correction take less active editing time than manual editing? |
| V6 | Can both applications process long recordings within time, memory, and responsiveness limits? |
| V7 | Can the core workflow finish offline without paid inference? |
| V8 | Does each optional AI connection use only the selected provider and validated proposals? |

Rule correctness and speech preservation are separate outcomes. Passing a deterministic threshold test does not establish that a threshold is appropriate for human speech. Missing transcription is never evidence that an interval is silent.

## Scope and fixed settings

Initial supported media: H.264 SDR video in MP4/MOV, AAC audio, one selected output audio track, including variable-frame-rate inputs. Unsupported formats must be rejected clearly. Threshold editing remains available without VAD, transcription, or AI.

Initial settings are −40 dBFS, 500 ms minimum silence, 100 ms before speech, and 150 ms after speech. These are untuned starting values. VAD is an optional speech-protection layer with its own detection threshold; it does not change the meaning of dBFS.

## Independent reference data

Use deterministic PCM fixtures and an independent sample-based oracle. Do not call the product's interval functions or its FFmpeg log parser to generate expected results. For AAC-derived fixtures, decode the actual input first and calculate the reference from that PCM; the original uncompressed waveform is not an exact oracle after lossy encoding.

Human evaluation uses three private tuning recordings (R01–R03) and at least six separate evaluation recordings (R04–R09), each 5–15 minutes, covering quiet rooms, soft speech, and background noise. Thirty- and sixty-minute performance inputs are separate from this quality set.

Label speech-safe, pause-safe, and ambiguous regions before viewing the app's proposed cuts. Record ambiguous duration and counts, but exclude them from ratio denominators. Keep private recordings outside Git. Freeze settings after tuning. Retuning on held-out evaluation results invalidates that evaluation as an independent test.

## Correctness and quality targets

| Measure | Required result |
| --- | --- |
| Rule boundaries | Exact sample/frame result where specified; sample comparisons within one sample |
| Clipped words or syllables | Zero |
| Removal precision by duration | At least 99% |
| Eligible pause removal by duration | At least 90% |
| Cuts restored because of quality | At most 5% of automatic cuts |
| Lost/reintroduced content | Zero unintended occurrences |
| Source modification, lost edit state, or false success | Zero |

Eligible pause duration excludes intentional padding and pauses below the minimum duration. Record numerator and denominator for each metric and each recording. A zero denominator is N/A with an explanation, not 100%. Review every cut boundary and play the complete output at least once. Unresolved speech judgments remain unresolved; identical transcripts do not prove preserved pronunciation.

## Audio/video synchronization

Use independently detected flash/beep markers near every relevant cut and at the beginning, middle, and end. Normalize input start PTS and documented encoder padding. Check both content alignment and expected output duration.

The per-marker tolerance is the larger of the local output video-frame duration and decoded codec audio-frame duration. For 30 fps and 48 kHz AAC with 1,024 samples per frame, the tolerance is about 33.34 ms. For VFR, use the actual local frame interval rather than average fps. The difference between the first and last marker errors must also remain within that tolerance; passing only a final duration check is insufficient.

## Editing-time comparison

Use a paired manual/HyperCut comparison with the same completion criteria and balanced order. Exclude practice runs and record recall effects. Track active editing/review time separately from processing wait and total elapsed time.

For each recording, savings = 1 − automatic-workflow active time / manual-workflow active time. The target is at least 50% median savings among quality-passing results, while separately reporting excluded quality failures. Include low-pause recordings and negative savings instead of discarding inconvenient outcomes.

## Cost validation

The core workflow must use zero paid model requests. Initial tool/model downloads are setup activity, not inference. Saving or switching provider settings must issue zero inference requests. An explicit request must use only its selected provider, with no automatic paid fallback.

Before an authenticated test, record a call/usage/cost ceiling, including retries and failed or canceled requests. The operator stops the test at the ceiling; this is a test procedure, not a claim that the app implements a cost-control UI. Preserve per-attempt model and usage evidence. Unavailable billing data is unknown, not zero. Do not claim subscription savings without verified baseline cost and frequency.

## Performance protocol

Freeze chip, OS, RAM, tool/model versions, SSD location, power conditions, app build, and runner. Use 1080p30 H.264/AAC at 48 kHz for 10- and 60-minute conditions, including a 60-minute, 1,000-cut stress case.

| Measure | Target |
| --- | --- |
| File selection to editable draft, including upload/decode/waveform/frame indexing | At most 20% of source duration |
| Export, including verification | At most source duration |
| Union of app and child-process RSS | At most 2 GiB, including 1,000-cut conditions |
| UI response | p95 at most 200 ms over at least 30 actions |
| Visible cancellation response | At most 300 ms |
| Ready to retry after cancellation | At most 5 seconds |

Measure cold and warm conditions separately with three runs per condition and per application. Preserve raw values, median, and maximum; three runs do not justify a p95 estimate. Do not run human timing sessions concurrently with performance jobs. Browser evidence is not native-package evidence.

## Gates and release decision

| Gate | Required evidence |
| --- | --- |
| G0 | Frozen plan, fixtures, independent oracle, settings, and identified artifacts |
| G1 | Domain rules and actual short-media output correctness |
| G2 | Required D/M/U/E cases in browser and native app, including supported formats and P0/P1 recovery |
| G3 | Human quality, editing-time savings, and final-candidate long-run performance |
| G4 | Each enabled AI connection tested with its actual selected provider/account |

G4 does not block a local-only release satisfying G1–G3. Mock responses do not satisfy real connection verification. Speech clipping, synchronization failure, source modification, lost work, or false success block the corresponding release claim. Do not raise the threshold to manufacture apparent efficiency.

Record code commit, dirty state, browser/server bundles, native package, models, runner, input/oracle hashes, and settings before running. Existing evidence applies only when its identities and conditions match. After a change or failure, rerun affected checks; unrelated repetition is not a substitute for resolving the failure. Use the [first execution batches](2026-09-05-test-plan.md#9-first-execution-batches) and [result template](../testing/test-run-template.md).
