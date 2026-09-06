# HyperCut validation run template

This is an empty template, not an execution result. Copy it before a run and fill only observed values. Leave unexecuted items as `NOT_RUN`.

## Run identity

- Run ID / date and time / operator:
- Code commit / uncommitted changes:
- Browser and local server, or installed Mac app / actual bundle and package hashes:
- Test plan and fixture-manifest versions:
- Runner / independent oracle or human-label versions and hashes:
- OS / chip / RAM / power / storage type:
- App / FFmpeg / ffprobe / runner versions:
- Input fixture IDs / SHA-256 / codecs, tracks, FPS, sample rates:
- Amplitude threshold / minimum duration / speech padding / selected track:
- VAD enabled / model and native-runtime versions and hashes:
- Cold, warm, or uncontrolled cache condition / network state:
- Target gates / exclusions and reasons:
- Cases, platforms, and input conditions / missing material or authentication:

Use a new run ID when the frozen product, data, or settings change. Do not fill an unexecuted condition using a pass on another platform or input. Identify browser evidence and installed Mac-package evidence separately.

## Results

| Case ID | Status | Independent expectation | Actual result / measurement | Evidence | Failure, block, or N/A reason |
| --- | --- | --- | --- | --- | --- |
| To fill | NOT_RUN | To fill | Not measured | None | Not executed |

Allowed states: `NOT_RUN`, `PASS`, `FAIL`, `BLOCKED`, `N/A`. Never mark an unexecuted case as PASS.

## Media and speech quality

- Source SHA-256 before / after:
- Expected and actual candidate, removed, and retained interval files:
- Expected duration / decoded duration / error / tolerance basis:
- Source-to-output marker errors / additional A/V error / cumulative error:
- Full decode outcome / error logs:
- Cuts reviewed / clipped words or syllables / undecided cuts:
- Time-based removal precision / target-pause removal / denominators:
- Restored cuts / total cuts / reasons:
- Full-playback and boundary-listening records:

## Time and performance

| Video ID / order | Manual active time | HyperCut active time | Analysis wait | Export wait | Total elapsed | Quality |
| --- | --- | --- | --- | --- | --- | --- |
| Not run | Not measured | Not measured | Not measured | Not measured | Not measured | NOT_RUN |

- Per-video time savings / median / comparison limits:
- Per-run analysis and export values / median / maximum:
- Maximum simultaneous app-plus-child-process RSS:
- UI sample count / p95 / measurement method:
- Cancellation feedback / process-exit delay / retry outcome:

## AI connections, when applicable

- Provider / model or tool / connection type / mock or actual:
- Pre-run request, usage, or spending ceiling / stop conditions:
- Requested task / result validation / error and cancellation handling:
- Inference calls during settings save/switch / requests, retries, failures, cancellations:
- Usage / actual billing verification / evidence:
- Request-data inspection:

Record unavailable billing as `UNVERIFIED`, not zero cost. Distinguish the experiment's spending ceiling from any cost-limiting feature actually provided by the app. Do not include API keys, tokens, complete personal paths, or private recordings/transcript text.

## Transcription, captions, and effects, when applicable

- Engine / model version and SHA-256 / language / track and channel:
- Mock, TTS, or human recording / tuning or evaluation / reference source:
- CER normalization / substitutions, deletions, insertions / reference character count / CER by condition:
- False captions during silence / start/end error distributions / errors over 500 ms:
- Meaning, numbers, units, names, and correction results / unresolved errors:
- Source-to-edited cue times / cut-boundary reviews required and resolved:
- Independent SRT parse / actual composed frames / font and renderer versions:
- Effect asset IDs / placement, duration, gain / output markers, peaks, clipping:
- Project version / migration / preserved changes:
- Caption-work time savings / inference and render waits / total RSS:
- Model preparation and inference network state / actual external requests and costs:

## Gates and follow-up

- G0 / G1 / G2 / G3 / G4 verdicts: NOT_RUN
- Unresolved failures, undecided cases, or blocks:
- Reproduction / fix scope / cases to rerun:
- Changed criteria: before, after, reason, first applicable run ID:
- Evidence supporting progression to the next stage:
