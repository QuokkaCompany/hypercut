# HyperCut implementation plan

Created 2026-09-05. This is an implementation sequence and historical progress record; acceptance remains governed by the [validation plan](2026-09-05-validation-plan.md) and [test plan](2026-09-05-test-plan.md).

## Architecture

Use a shared React/TypeScript UI with a Node local server for streamed imports and processing jobs. Electron embeds the server and supplies native file dialogs; the browser uses the same local service rather than uploading media to a hosted backend. Discover FFmpeg/ffprobe locally with environment overrides.

Keep editing-domain functions independent from UI/process execution. Use Node tests for deterministic domain contracts and real FFmpeg fixtures for media correctness. Preserve source identity and nondestructive project edits, with job IDs/revisions preventing stale results.

## Implementation order

1. Implement settings validation, half-open source intervals, padding/minimum-removal rules, inward frame snapping, kept ranges, restoration, undo/redo, and project serialization against independent examples.
2. Implement actual probing/decoding/analysis/rendering and independent full-output validation before expanding the UI. Stream f32 PCM and use inclusive absolute-value comparison across all channels. FFmpeg silencedetect parsing is not an interchangeable oracle because its boundaries/comparison may differ.
3. Assemble kept audio continuously and encode AAC once to avoid per-segment packet-padding drift. Use balanced expressions for large video selection graphs. Handle VFR with actual frame timestamps and verify selected tracks, PTS normalization, and supported formats.
4. Add local API imports, job progress/cancel, atomic outputs, failure recovery, and source protection. Exit zero or an existing file is not sufficient success.
5. Add the editing UI: import, settings, waveform/timeline, editable cut draft, restore, precise previews, project save/reconnect, and validated MP4 export. Exercise both browser and native paths, including packaged native dependencies.
6. Add optional AI settings proposals with bounded structured output, selected-provider routing, explicit review/apply, cancellation, and no fallback. Local editing remains usable without AI.

## Follow-on implementation

The initial preview/core stages and AI settings paths were implemented. Manual ChatGPT JSON exchange did not establish account-connected MCP support. Mock CLI child-process and installed login-status checks did not establish authenticated inference.

Add local Whisper transcription with source-time captions, text/timing edits, review gates, SRT, and project v3. Add bundled-font caption designs and actual MP4 overlay with v4; distinguish renderer readiness, actual output, and language accuracy. AI correction sends at most 20 cues/4,000 characters without cue timing, rejects numeric changes, flags negation review, and applies selected proposals through existing undo history.

Local effects add hashed asset identity/reconnection, source-time placement, gain/mute/trim, actual mixing, and pre/post-AAC peak checks in project v5. AI effects use bounded selected assets/clips/reference text and existing proposal validation; its 108-check record establishes contracts, not real model placement quality. Project v6 adds glossary persistence and per-request overrides. Project v7 preserves narrow end-overflow warnings and explicit review before output.

Later plans and results cover local MCP lifecycle, readiness/download recovery, repeated-memory investigation, source-range clips, TXT transcripts, multilingual recognition/translation, and project v8. See the [plan index](README.md), [feature plan](2026-09-05-caption-effects-validation-plan.md), [multilingual plan](2026-09-06-clips-multilingual-plan.md), and [testing index](../testing/README.md) for build-specific completion and outstanding gates. Historical performance passes do not automatically transfer to a changed UI or package.
