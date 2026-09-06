# Transcription, captions, and sound effects: validation and test plan

Created 2026-09-05. Implementation and validation are partial. Separate evidence covers [transcription/v3](../testing/2026-09-05-transcription-results.md), [caption rendering/v4](../testing/2026-09-05-caption-rendering-results.md), [AI correction](../testing/2026-09-05-caption-correction-results.md), [local effects/v5](../testing/2026-09-05-effects-results.md), and [AI effects](../testing/2026-09-05-ai-effects-results.md). Human recordings, correction/placement quality, human listening, and the long-performance conditions not completed in those records remain unverified.

This extends the [validation plan](2026-09-05-validation-plan.md) and [MVP test plan](2026-09-05-test-plan.md): seven T, ten C, and five FX cases, separate from 39 MVP, eight AI, and seven VAD cases. Existing automated pass counts do not establish these features' acceptance.

## Requirements and contracts

Prioritize speech-preserving cuts, local transcription, caption editing/style/output, AI correction, then effects. Incorrect transcription must never automatically delete speech. Store amplitude, VAD probability, and STT text/timing as distinct data.

Transcription records original identity, selected track/channel, language, engine/model versions, and source-time cues. Text/timing are editable and retranscription must permit review or undo. Explicitly select a channel (automatic only for mono); do not average away opposite-phase speech or claim unverified multichannel merging. Separate model preparation/download/progress/cancel from offline inference. Reject incomplete models and distinguish missing/corrupt/unsupported components without cloud fallback.

Captions use half-open source intervals. At output, intersect final kept intervals and map to edited time. Restoring cuts recomputes from source time, without subtracting durations twice.

| Kept intervals | Source cue | Independent expectation |
| --- | --- | --- |
| `[0,2), [4,8), [9,12)` | `[5,6.2)` | Output `[3,4.2)` |
| Same | `[2.5,3.5)` | Omitted from output; preserved in project |
| Same | `[1.5,4.5)` | Retained pieces `[1.5,2), [2,2.5)`; boundary review required without verified word timing |

Do not duplicate an entire sentence over cut fragments. Only verified word timing can justify automatic word placement. Otherwise flag wording/timing review and block captioned output until resolved; plain video remains possible. New cuts can invalidate review.

Persist text, timing, style, and visibility with versioned migrations from v1/v2, preserving source/cuts/VAD. Caption undo shortcuts during typing must not unexpectedly edit cuts. Changed cuts/captions/style/track invalidate rendered results. SRT contains escaped UTF-8 text and edited timing, not design. Treat user text as plain data, never ASS/HTML/path/shell instructions. Missing renderer/fonts must produce an actionable failure, never a successful captionless result.

Effects are local clips with source placement, asset offset/duration, gain, and mute. A deleted starting point omits the clip; restoring the cut restores it. Never move it to nearby speech. A retained start maps to edited time, ending at the earliest asset/user-duration/video boundary. Persist identity/edit values and require correct reconnection. Use original synthetic beeps for tests.

## Fixtures and acceptance targets

| Fixture | Independent material/purpose |
| --- | --- |
| TR01 | Original Korean TTS script with leading/middle/trailing silence; real engine/timing/offline mechanics, not human accuracy |
| TR02 | Right-only/opposite-phase/44.1–48 kHz/PTS-offset/VFR derivatives; channel and source-time checks |
| TR03 | Private tuning segments from R01–R03 only |
| TR04 | At least six independent R04–R09 evaluation segments totaling ≥30 minutes, human transcript/word-syllable timing/terms/numbers/negation labels |
| CR01 | Fixed timeline examples plus Korean/English/numbers/newlines/reserved characters |
| FR01 | Known sample-accurate beep onset/duration/amplitude and video flashes |

Never tune on TR04. Report ambiguity exclusions and denominators, including ordinary/soft/noisy/technical speech by condition. Freeze targets before observing results.

- CER = (substitutions + deletions + insertions) / reference characters. NFC-normalize, remove spaces/common punctuation, retain numbers/units/negation/terms. Preserve raw score and normalization rules. Empty reference means N/A plus separate hallucinated-cue count.
- Initial CER targets: ≤10% quiet Korean, ≤20% soft/noisy Korean. No promise of fully accurate unreviewed transcripts.
- At least 95% of reviewed cue starts/ends within 200 ms of human labels; individually record/correct every error >500 ms. This does not relax frame-level mapping tolerance.
- Zero unresolved changes to facts/numbers/units/names/negation after correction. Fluent wording alone is not success.
- Median per-video active-time savings ≥30% for equivalent-quality SRT and captioned MP4; separate from silence-only Q04's ≥50%. Report processing waits separately.
- Mapping within one output frame, SRT rounding within 1 ms, zero missing/duplicate/broken text or stale-result success.
- Real-model 10-/60-minute performance, three runs per engine/model/platform: time ≤source duration, union app/model RSS ≤4 GiB, UI p95 ≤200 ms, retry readiness after cancel ≤5 s. Do not mix this allowance with silence-analysis limits.

## Transcription cases

P0/P1 are both required for a feature's validated support. P0 protects state/source/data; P1 covers actual quality/performance/use.

| ID | Priority | Test and required evidence |
| --- | --- | --- |
| T01 | P0 | Real TR01 inference with external network blocked; valid Korean text/timing, zero external attempts; mock CLI is insufficient |
| T02 | P1 | TR04, complete silence, and music-only; CER/timing by condition, zero silence hallucinations, music misrecognitions recorded |
| T03 | P0 | TR02 and multiple tracks/channels; selected signal only, no right-channel loss/phase cancellation/double PTS correction |
| T04 | P0 | Cancel setup/decode/inference, kill process, inject disk faults; cleanup, preserved captions/cuts, retry, no partial-success claim |
| T05 | P0 | Missing model/engine, wrong hash, truncated download; distinct causes, preserve existing model/source, no incomplete install/cloud fallback |
| T06 | P0 | Change file/track/language during request, stale response, retranscribe; no overwrite of newer project/manual captions |
| T07 | P1 | Fixed-model short repetitions and 10-/60-minute runs; valid ordered ranges, hashes/settings/time/RSS/cancel evidence; identical text is not accuracy proof |

## Caption cases

| ID | Priority | Test and required evidence |
| --- | --- | --- |
| C01 | P0 | CR01 retained/deleted/restored/VFR mapping; fixed times, source preservation, no double subtraction |
| C02 | P0 | Cue crosses one/multiple cuts without word timing; review flag, no sentence duplication, block unresolved captioned export but allow plain output |
| C03 | P0 | Text/timing/style edits, undo/redo, typing shortcuts; intended state, unchanged cuts, invalidate old rendering |
| C04 | P0 | v1/v2 migration, new round trips, invalid timing/duplicate IDs; preserve cuts/VAD/style/edits, reject corrupt data without losing current work |
| C05 | P0 | Real SRT/MP4; independent parser, actual Korean/layout/timing frames, full decode; no SRT-design claim |
| C06 | P1 | 16:9/9:16, long Korean/English, two lines, small window, missing font; readable safe area, no clipping/broken glyphs, actual rendered-image review |
| C07 | P0 | Glossary/numbers/negation AI corrections, accept/reject/undo; compare and select, preserve timing/meaning, restore original |
| C08 | P0 | Provider switch/error/cancel/quota/stale project; A01–A08, exact selected transmission scope, no unselected calls/automatic re-billing |
| C09 | P0 | Missing renderer/font, save race, render cancel; no captionless false success, preserve files/project and recover |
| C10 | P1 | Offline browser/native transcription/edit/style/restore/reconnect/SRT/MP4; separate screen/file evidence for both |

## Effect cases

| ID | Priority | Test and required evidence |
| --- | --- | --- |
| FX01 | P0 | FR01 before/after cuts, deleted start, video end, restoration; independent marker placement, no silent relocation |
| FX02 | P0 | Trim/gain/mute/overlap and actual decoded audio; independent PCM signal/duration/gain, no mute leakage, measure peaks/clipping |
| FX03 | P0 | Move/delete/restore/undo/save, missing/moved asset; reproduce values, no automatic substitution, explicit reconnect/exclude |
| FX04 | P0 | Selected-provider proposals, invalid ranges/duplicates/stale responses; only allowed clip operations/assets, no duplicate application |
| FX05 | P1 | Both apps' composed captions/cuts/effects, cancel/retry; actual sync/full decode/listening and preserved completed files; UI preview alone is insufficient |

## Execution and recorded technical conditions

Start with mapping/storage C01–C04, then real short Korean/offline engine and recovery, then SRT/renderer and actual frame review in both apps. Tune only on tuning material; use TR04 for quality/time and separately measure long performance. Verify actual selected AI after mocks. Build effects from FR01 mapping and assess composed output.

A feature is validated only after its required cases pass. Review with G1–G4; unresolved speech/meaning damage, wrong timing, lost saves, source modification, or false success blocks the affected claim. Use the [result template](../testing/test-run-template.md) for code/model/font/renderer identity, fixture/oracle hashes, CER numerators/denominators, frames/listening, time/RSS/calls/usage. Keep private transcripts and keys outside Git.

At initial planning on 2026-09-05, `whisper-cli`, `whisper-cpp`, and `cmake` were absent from PATH. FFmpeg `-h filter=subtitles` and `-h filter=ass` both reported `Unknown filter` despite exit zero. Thus exit codes alone do not establish readiness. The later pinned whisper.cpp build and verified small model were packaged; human Korean accuracy remained unverified. Initial references: [project](https://github.com/ggml-org/whisper.cpp), [CLI source considered](https://github.com/ggml-org/whisper.cpp/blob/b4938/examples/cli/cli.cpp), [libass conditions](https://ffmpeg.org/ffmpeg-filters.html#subtitles-1).

The implementation instead uses bundled Noto Sans KR and `@napi-rs/canvas` PNGs with FFmpeg `overlay`, retaining global FFmpeg and the same frame/timing criteria. See [glossary plan](2026-09-05-project-glossary-plan.md)/[results](../testing/2026-09-05-project-glossary-results.md), [transcription performance plan](2026-09-05-transcription-performance-plan.md)/[results](../testing/2026-09-05-transcription-performance-results.md), and [end-boundary plan](2026-09-05-transcription-end-review-plan.md)/[results](../testing/2026-09-05-transcription-end-results.md). Synthetic repetition, unpurged OS caches, and caption-selection-only timing retain their limits. General out-of-range project cues remain rejected; corrected model-overflow cues require review before export.
