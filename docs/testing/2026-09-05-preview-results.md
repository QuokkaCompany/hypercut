# Initial preview execution and validation — 2026-09-05

A working Electron Mac/local-browser preview was implemented, not a fully validated MVP. It includes import/track selection/settings/waveform/cuts/restore/undo/projects/reconnect/fast and rendered preview/validated MP4. At this stage the engine was amplitude-only; VAD/STT, automatic subscription login/MCP/CLI were later work. Optional settings adapters used Ollama/OpenAI/Anthropic or manual ChatGPT/Claude JSON exchange. No hosted deployment.

Environment: M4 Max/Mac16,9, 14 CPUs/36 GiB, Darwin 25.5.0 arm64, Node 24.14.1, Electron 44.2.0, FFmpeg 8.1.1. Power/background load uncontrolled, OS caches unpurged. Native package at `release/HyperCut-darwin-arm64/HyperCut.app`, browser `dist/`; external FFmpeg, unsigned/unnotarized, Windows/Linux untested.

Checks: 25 units, five media, ten compatibility, six API, three failure = **49 PASS**. Build/package/both-app E2E, benchmarks, long sync, and stress separate. Native dialog return paths were supplied, not actual OS interaction. Large local logs/media/screenshots are excluded; small evidence JSON is linked.

## Media and measured performance

A fixed two-cut 16-second input yielded exactly 12 seconds, 360 frames, and 576,000 pre-encode audio samples, fully decoded with unchanged source hash. Default −40 dBFS/500 ms/pre100/post150 produced five cuts and about 9.067 s from a tone/silence demo, not speech.

CFR/VFR/+3 s PTS markers showed additional A/V error ≤5 ms across five markers; retain original VFR offset separately. Last two markers after a 60-minute/1,000-cut run had additional error about −0.066/0 ms, not a human review of every boundary. Selected microphone/other track matched analysis/source preview/output with one output audio track. Ten representative MP4 mono48k/MOV stereo44.1k ×24/25/29.97/30/60 fps combinations passed, not every format combination.

A 29.97 fps fractional-sample end mismatch incorrectly retained nonexistent trailing speech padding. Extend only final continuous silence to the video's fractional sample end; actual format and unit regression passed.

| Input | Analysis median/max s | Export median/max s | Engine/child RSS GiB | Cuts |
| --- | --- | --- | --- | --- |
| 10 min | 5.52/5.55 | 15.34/15.60 | 0.808 | 166 |
| 60 min | 35.54/35.87 | 114.33/114.95 | 1.022 | 1,000 |

Three runs each on simple 1080p30 H.264/AAC48k. Analysis includes inspection/hash/frame index/PCM/waveform, excluding browser upload/UI readiness. Export includes full decode. RSS samples every 250 ms exclude browser/Electron renderers, so these do not pass whole-app 2 GiB. Inter-sample peaks/cold cache are unknown. Some documentation/build/mock work overlapped, other media tests did not.

Browser 1,000-cut restore/undo 32 actions: p95 32.9 ms through two frames; analysis cancellation to cleared job 264.7 ms. Does not cover all actions or Mac performance.

## Historical case status

PASS in specified fixture scope: D01–D11, D13–D14, M01–M05, U04–U05, mocked A03–A04. NOT_RUN/partial: D12 (short-media/full restore), D15 (late responses), M06 (human boundary listening), U01 (native OS offline), U02–U03 (full controls/all-silent partial restore), E01–E06 (remaining phases/OS/save/stale combinations), P01–P02 (whole-app/cache/final UI), Q01–Q05 (no human data/labels/timing), A01–A02/A05–A08 (actual connections and remaining lifecycle/privacy/tool cases). Some subchecks passed; this does not lower full-case requirements. Ollama was not found and authenticated usage was not tested.

Next: user-designated Korean tuning/evaluation, remaining failures/UI/whole-app measurements, and separately selected authenticated AI. No unrelated private media was searched. G1 core technical evidence passed its scope, G2 partial, G3 NOT_RUN, G4 actual-provider acceptance pending. Later recovery records supersede only explicitly updated conditions.

## Evidence and related records

- [2026-09-05-recovery-results.md](2026-09-05-recovery-results.md)
- [2026-09-05-results.json](results/2026-09-05-results.json)
- [2026-09-05-long-sync.json](results/2026-09-05-long-sync.json)
- [2026-09-05-ui-stress.json](results/2026-09-05-ui-stress.json)
