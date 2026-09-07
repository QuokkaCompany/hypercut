# HyperCut validation and testing

Updated September 7, 2026. Plans, automated checks, and human acceptance are distinct. **Full MVP acceptance is not complete.** Historical results apply to the exact candidate, package, input, and runner named in each record.

## Current evidence

The [Go cloud API record](2026-09-07-go-api-results.md) covers existing cloud contract/browser tests against Go, Node/Go data compatibility, Go race checks, and actual Linux CPU speech/caption export. It does not claim a performance improvement or a Node-free runtime.

The [multilingual feature record](2026-09-06-multilingual-results.md) covers ten language choices, translated captions, TXT transcripts, range/sentence clips, v8 projects, and save round trips in both apps. Actual local transcription was checked with English, Japanese, and Chinese TTS plus Japanese automatic detection. AI behavior was checked with mock responses and actual local MCP transport, without authenticated model requests.

The earlier readiness candidate `93d616f` completed [eight short and 24 long threshold-mode runs](2026-09-06-candidate-93d616f-results.md), with four short and eight long cancellation/retry conditions. Long runs covered 10/60 minutes, both apps, warm/cold input files, and three repetitions, with maximum RSS 1.933 GiB. These measurements do not transfer to the later multilingual build.

[Transcription readiness](2026-09-06-transcription-readiness-results.md) passed 22 cause-specific checks, actual recovery and Whisper inference in both apps, edit preservation, and four existing transcription integrations. [MCP lifecycle](2026-09-06-mcp-lifecycle-results.md) passed 12 delayed/failure conditions and six complete settings/caption/effect flows. Neither establishes real-account connectivity or human model quality.

The earlier [two-thread composition candidate](2026-09-06-encoder-two-results.md) completed 12 long runs and four cancellation/retry conditions with maximum RSS 1.956 GiB. Full decoded frame/PTS/audio comparisons linked the 60-minute outputs to the earlier candidate. Its [cache-conditioned composition checks](2026-09-06-input-cache-results.md) completed six of 24 planned long conditions; the other 18 were not run.

Earlier failures remain in the records. Several browser candidates exceeded 2 GiB on repeated exports. A later full-frame oracle found a cut-boundary defect even though prior sync/byte-comparison checks had passed. Candidate-specific correctness fixes and performance reruns must not be combined into an unsupported current-build claim.

## Plans and procedures

- [Validation plan](../plans/2026-09-05-validation-plan.md): quality/performance targets, independent references, and release gates.
- [Test plan](../plans/2026-09-05-test-plan.md): 39 MVP cases, comprising 28 P0 and 11 P1 cases, plus eight subsequent AI cases.
- [Run template](test-run-template.md): record environment, identity, expectations, measurements, failures, and unexecuted conditions.
- [Human Korean evaluation](manual-korean-evaluation.md): separate tuning/evaluation recordings, source labels, boundary listening, restoration, and active-time comparisons. The templates contain no completed human evaluation.
- [Speech protection](../plans/2026-09-05-speech-protection-plan.md): additional S01–S07 conditions for optional local VAD.
- [Transcription, captions, and effects](../plans/2026-09-05-caption-effects-validation-plan.md): seven transcription, ten caption, and five effect cases, with quality, timeline, rendering, and time criteria.
- [Long composition](../plans/2026-09-06-long-composition-plan.md): actual outputs, cancellation, saving, memory, and interaction across long recordings.
- [Cache verification](../plans/2026-09-06-cache-verification-plan.md): distinguish observed input-file residency from OS-wide cold-cache claims.
- [All implementation plans](../plans/README.md).

Test-code counts are not plan-case counts. One case can run on multiple platforms and failure conditions. A passing condition never fills another condition that was not executed.

## Acceptance targets

| Question | Target | Cases |
| --- | --- | --- |
| Do cuts follow settings? | Threshold, minimum duration, padding, channel, and frame boundaries match an independent oracle | D01–D15 |
| Is speech preserved? | Zero clipped words/syllables, at least 99% removal precision, at least 90% target-pause removal | Q01–Q03, Q05 |
| Is sync preserved? | Independent local/cumulative markers stay within the applicable video/audio frame tolerance | M01–M06 |
| Is work preserved? | No original modification, lost saved edits, or false success; failures allow retry | U03–U05, E01–E06 |
| Is editing faster? | Median active-time saving of at least 50% for quality-passing pairs | Q04 |
| Are long inputs usable? | Analysis ≤20% of input duration; export ≤input duration; app-plus-children RSS ≤2 GiB; interaction p95 ≤200 ms | P01–P02 |
| Does core editing work offline? | Open, edit, save, and export under OS-enforced external-network blocking | U01 |
| Is AI explicit and recoverable? | Validated proposals, preserved edits, and provider-specific actual authentication/response evidence | A01–A08 |

These are acceptance goals, not published human-quality or productivity results. Transcription has its own resource criteria in the corresponding plan. Use the documented formulas and exclusions.

## Running checks

Start with the contributor checks:

```sh
npm ci
npm test
npm run build
npm run test:media
npm run test:api
```

Unit tests and build are quick checks. Media/API integration suites require FFmpeg/ffprobe and permission to launch subprocesses and local servers. Public CI runs unit tests, build, and media integrations on Linux with Node 22 and 24; this does not establish a supported Linux desktop package.

| Additional area | Entry point | Prerequisites or limits |
| --- | --- | --- |
| VAD | `npm run test:speech` | Bundled ONNX model and compatible native runtime; macOS TTS fixtures where used |
| Transcription | `npm run test:transcription` | Prepared whisper.cpp/model, FFmpeg, and fixture TTS voices |
| Captions / effects | `npm run test:captions`, `npm run test:effects` | FFmpeg and bundled fonts/native canvas |
| AI contracts | `npm run test:correction`, `npm run test:ai-effects`, `npm run test:claude` | Mocks and local subprocesses; no authenticated quality claim |
| MCP | `npm run test:mcp` | Local HTTP/stdio subprocesses; no account/tunnel validation |
| Multilingual | `npm run test:multilingual` | Media/API fixtures; actual language inference has a separate script |
| Browser UI | `npm run test:e2e` and area-specific E2E scripts | Installed browser, running/launchable app, test-owned output paths |
| Native UI | Area-specific scripts with `--desktop` where documented | Fresh Mac package and required native resources |
| Long performance | Area-specific benchmark scripts | Frozen candidate, inputs, settings, runner, and a fresh evidence directory |

Inspect the relevant script and dated record before running specialized suites. Native save-dialog, disk-full, offline, process-kill, and cache tests have environment-specific requirements. Never run destructive failure injection against personal files or an unrelated app session. Use synthetic test-owned data and fresh `test-output/` directories. Large media and private human-evaluation files are intentionally ignored; checked-in JSON summaries retain the useful measurements.

## Evaluation order and remaining gates

1. Validate synthetic PCM/video against independently derived cut boundaries.
2. Produce actual MP4 files and check complete decoding, markers, duration, and selected tracks.
3. Exercise editing, restoration, save, cancellation, and failures in Chrome and the Mac package separately.
4. Tune settings on three designated Korean recordings, then freeze them.
5. Evaluate at least six separate Korean recordings for speech, pauses, restoration burden, and active time.
6. Run required 10/60-minute and 1,000-cut conditions against the final candidate before judging G1–G3.
7. After mock contracts, validate each authenticated AI provider separately for G4.

G1 has core media evidence. Named G2 checks include native save/crash/reopen, delayed I/O, cancellation/project races, actual overwrite dialogs, and source-path protection. Mac OS-level network blocking remains outstanding. G3 human Q01–Q05 and final-candidate long composition remain incomplete. G4 authenticated LLM requests remain unexecuted. Human CER, translation/correction quality, effect listening quality, clean-machine installation, signing, and notarization are also unverified.

Default silence analysis is amplitude-based; it is not speech recognition. Optional VAD detects speech, while Whisper provides transcription. Passing synthetic TTS does not prove recording accuracy. If quiet syllables are still cut, product quality fails even when rule tests pass.

## Dated evidence index

Each record below identifies its own scope, failures, and source evidence. Older unimplemented or incomplete states describe that stage, not necessarily the current feature set.

- [AI sound-effect proposal results](2026-09-05-ai-effects-results.md)
- [AI caption correction results](2026-09-05-caption-correction-results.md)
- [Caption design and actual MP4 rendering results](2026-09-05-caption-rendering-results.md)
- [Claude Code integration verification — 2026-09-05](2026-09-05-claude-cli-results.md)
- [Native save interruption and reopening](2026-09-05-desktop-save-crash-results.md)
- [Caption-editor cancellation retry and source preservation](2026-09-05-editor-job-race-results.md)
- [Preventing project replacement and mixed effects during import](2026-09-05-effect-import-project-race-results.md)
- [Local sound-effect editing results](2026-09-05-effects-results.md)
- [Cancellation responses versus the next project](2026-09-05-job-cancellation-race-results.md)
- [Actual Mac save and replacement dialogs](2026-09-05-native-save-dialog-results.md)
- [Initial preview execution and validation — 2026-09-05](2026-09-05-preview-results.md)
- [Project correction glossary results](2026-09-05-project-glossary-results.md)
- [Preserving edits against late project reads and saves](2026-09-05-project-io-race-results.md)
- [Selected-range preview verification — 2026-09-05](2026-09-05-range-preview-results.md)
- [Recovery, partial restoration, and app performance — 2026-09-05](2026-09-05-recovery-results.md)
- [Local speech-protection results — 2026-09-05](2026-09-05-speech-protection-results.md)
- [Transcription end-overflow reproduction and recovery](2026-09-05-transcription-end-results.md)
- [Long transcription performance results](2026-09-05-transcription-performance-results.md)
- [Local transcription and caption editing results](2026-09-05-transcription-results.md)
- [Threshold editing on readiness candidate 93 d 616 f](2026-09-06-candidate-93d616f-results.md)
- [Caption-screen selector overhead and lifecycle comparisons](2026-09-06-caption-selector-results.md)
- [Reducing transparent caption-image work](2026-09-06-caption-strip-results.md)
- [Composition in the browser and native app](2026-09-06-composition-app-results.md)
- [Whole-frame checks found and fixed cut-boundary errors](2026-09-06-composition-oracle-results.md)
- [Editor rendering reuse: both candidates failed memory limits](2026-09-06-editor-render-memory-results.md)
- [Two encoder threads: composition performance](2026-09-06-encoder-two-results.md)
- [Input-file cache measurements for composition](2026-09-06-input-cache-results.md)
- [Late MCP application checks and new-request preservation](2026-09-06-mcp-lifecycle-results.md)
- [Local MCP protocol and editing proposals](2026-09-06-mcp-results.md)
- [Local transcription download cancellation and recovery](2026-09-06-model-download-recovery-results.md)
- [Clips, TXT transcripts, and multilingual captions](2026-09-06-multilingual-results.md)
- [Encoder concurrency: VAD memory improvement](2026-09-06-render-memory-results.md)
- [Automation selector overhead and historical performance](2026-09-06-selector-overhead-results.md)
- [Threshold mode with 1,000 cuts: one memory failure](2026-09-06-thousand-cut-performance-results.md)
- [Threshold-mode input cache verification](2026-09-06-threshold-input-cache-results.md)
- [Transcription readiness and actual recovery](2026-09-06-transcription-readiness-results.md)
- [VAD performance: initial memory failures](2026-09-06-vad-performance-results.md)
- [Windowed cut and caption lists](2026-09-06-windowed-lists-results.md)

## Cloud beta

`npm run test:cloud` requires Node 24+, FFmpeg and local-port permission. It creates disposable accounts and files, starts a separate worker, checks ownership/CSRF, upload resume, revision conflicts, queued jobs, cancellation, worker crash recovery, export decoding, quotas and session-scoped AI settings. `npm run test:cloud:e2e` verifies the browser flow after `npm run build`; it writes synthetic evidence to ignored `test-output/cloud-e2e/`. Paid model requests are not used.

See the [2026-09-07 cloud beta results](2026-09-07-cloud-beta-results.md) for executed checks and remaining limits.
