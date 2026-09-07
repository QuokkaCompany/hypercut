# Validation and test plan guide

Updated 2026-09-07. This index connects product requirements to testable evidence. Plans are acceptance criteria, not execution results or release approval. See [current/historical results](../testing/README.md).

Start with the [validation plan](2026-09-05-validation-plan.md) for speech preservation, usefulness, time savings, performance, and gates, and the [test plan](2026-09-05-test-plan.md) for fixtures, case IDs, actions, expectations, priorities, and evidence. Its [first execution batches](2026-09-05-test-plan.md#9-first-execution-batches) organize preparation and outputs into seven runnable groups.

The initial workflow is local browser or Mac import → automatic cut draft → preview/restore → project save → MP4. Add platform/media-specific validation when broadening support. [Clips/TXT/multilingual work](2026-09-06-clips-multilingual-plan.md) and [results](../testing/2026-09-06-multilingual-results.md) extend that scope.

## Product hypothesis

Removing unnecessary pauses while preserving speech should reduce active editing time. Interpret threshold first as dBFS plus minimum duration and speech padding. Low amplitude is not absence of speech; validate numeric rules and human quality separately.

| Approach | Validation role and limits |
| --- | --- |
| Amplitude threshold | Exact boundary baseline; quiet speech/background noise require human evaluation |
| Threshold plus local VAD | Compare speech protection, retained pauses, and extra processing; choose/freeze mode on tuning data |
| STT plus language model | Evaluate captions/corrections/context proposals and recognition/cost limits; failed transcription never justifies deleting speech |

VAD remains optional. Recommendations require real evaluation; dBFS and VAD probability are not interchangeable sliders or accuracy metrics.

## Requirement-to-evidence map

| Requirement | Objective/cases | Required evidence |
| --- | --- | --- |
| Threshold silence removal | V1; D01–D13 | Independent sample/duration/padding/channel/frame oracle |
| Quiet speech and endings preserved | V2; Q01–Q03/Q05, S01–S07 | Real labels, every cut boundary heard, restoration reasons; separate from TTS |
| Usable edits and preserved work | V3/V4; D14–D15, M01–M06, U01–U05, E01–E06 | Full MP4 decode, A/V markers, save/reconnect, faults/retry |
| Less repetitive work | V5; Q04 | Paired manual/automatic active time at equal quality |
| Long recordings | V6; P01–P02 | 10/60 minutes, 1,000 cuts, both apps, time/union RSS/UI/cancel |
| Core works without AI | V7; U01 | Actual offline import-to-export workflow |
| Select local LLM/ChatGPT/Claude | V8; A01–A08 | Selected provider only, reviewed apply, recovery, separate actual auth/inference |
| Transcription/correction/design/effects | T01–T07, C01–C10, FX01–FX05 | Independent transcripts, semantic comparison, actual frames and decoded effects |

There are 39 MVP cases, eight AI cases, seven [VAD cases](2026-09-05-speech-protection-plan.md), and 22 [T/C/FX cases](2026-09-05-caption-effects-validation-plan.md). Case counts are not automated function/pass counts.

API, local server, and subscription integrations require separate evidence. [MCP planning](2026-09-06-chatgpt-mcp-plan.md) and [local results](../testing/2026-09-06-mcp-results.md) do not establish real ChatGPT account/tunnel/model success. Core editing and saving connection settings require zero paid requests. Predeclare real-AI call/usage/cost limits, record actual attempts/billing, and leave unknown charges unknown; no fallback to an unselected paid provider.

## Initial acceptance targets

Zero clipped words/syllables, source changes, lost saves, or false success. Removal precision ≥99%; eligible-pause removal ≥90%; quality-driven restored cuts ≤5%; median active-time savings ≥50% among quality-passing recordings, reporting failures separately. Analysis ≤20% of input duration, export including validation ≤duration, union RSS ≤2 GiB, representative UI p95 ≤200 ms, visible cancel ≤300 ms, retry ≤5 seconds. Use detailed definitions in the validation plan. Empty denominators are N/A; unexecuted tests are NOT_RUN. Transcription resource/time-savings targets are separate.

## Execution order

1. G0: Freeze fixtures/oracles/hashes/hardware. Separate three tuning recordings from at least six independently labeled evaluation recordings; record missing prerequisites.
2. G1: Verify sample rules and actual frame-aligned MP4/sync, with short reproducible failures.
3. G2: Both apps' edit/restore/save/reconnect/export and cancellation, stale response, disk full, interrupted save, and offline behavior.
4. G3: Human speech/pause/restoration/time metrics with fixed settings; separately run three repetitions per long/cache condition and ≥30 interactions.
5. G4 and feature gates: Mock contracts/failures first, actual selected AI separately; complete T/C/FX requirements independently.

Use the [result template](../testing/test-run-template.md), [human Korean evaluation procedure](../testing/manual-korean-evaluation.md), and [implementation plan](2026-09-05-implementation-plan.md). No documentation update alone changes an execution status.

## Independent local and cloud editions

The [Go API migration plan](2026-09-07-go-cloud-api.md) and [design](../superpowers/specs/2026-09-07-go-cloud-api-design.md) define the Go public API, private media helper and compatible Node worker. The independent local runtime remains available.

The [cloud beta plan](2026-09-07-cloud-beta.md) and [approved design](../superpowers/specs/2026-09-07-local-and-cloud.md) cover a shared editing engine, independent local operation, account-scoped storage, durable jobs and a self-hosted SaaS path. Consult [cloud setup and limitations](../cloud/README.md) before deployment.
