# HyperCut: silence-first video editor design

Created 2026-09-05. Initial product contract; later implementation and evidence are tracked in the [plan index](../../plans/README.md) and [testing index](../../testing/README.md).

## Intent and scope

Build an affordable local video editor that reduces repetitive editing, beginning with automatic pause removal. Optional AI should connect to the user's chosen local model or supported ChatGPT/Claude integration for selected tasks. Core editing must work with AI disabled. Later features include transcription, typo correction, caption design, and sound effects.

Start with personal use on macOS and a local browser UI. Do not assume a particular recording genre. Initial supported inputs are H.264 SDR MP4/MOV with one selected audio track; unsupported HDR/HEVC must be explicit. This does not promise parity with full professional editors.

| Approach | Role |
| --- | --- |
| Amplitude threshold plus minimum duration | Required deterministic MVP baseline |
| Optional local VAD | Protect detected quiet speech; independently validate model behavior and human quality |
| STT plus LLM | Later captions/context proposals; transcription absence never establishes silence |

Amplitude dBFS, speech probability, and recognized text/timing are distinct concepts and controls.

## Editing flow

1. Import media and inspect available tracks/waveform.
2. Select the analysis track and configure threshold, minimum duration, and speech padding.
3. Analyze and create a complete editable cut draft without requiring approval for every individual cut.
4. Inspect the removal summary and listen around boundaries.
5. Restore any cut or partial source interval; use undo/redo.
6. Save project state without modifying the original.
7. Export and validate the actual MP4, with clear progress, cancellation, and retry.

State transitions: empty → inspecting → ready → analyzing → draft → preview/edit → exporting → complete. Failures and cancellation return to usable state while preserving completed edits/files. Progress represents actual stages, not invented elapsed-time percentages. Fast seek-based preview and encoded boundary/full previews must be distinguished.

## Silence contract

| Setting | Range | Initial value |
| --- | --- | --- |
| Amplitude threshold | −96 to 0 dBFS | −40 dBFS |
| Minimum silence | 50–5,000 ms | 500 ms |
| Before-speech padding | 0–1,000 ms | 100 ms |
| After-speech padding | 0–1,000 ms | 150 ms |

Raising a threshold from −50 to −30 dBFS removes louder material and can cut quiet speech. Defaults require tuning and human validation.

Analyze streaming decoded PCM, not downsampled display waveforms. An interval qualifies only while absolute sample amplitude on every channel is at or below the threshold for the minimum duration. Preserve either channel's speech, including opposite phase.

Represent source intervals as half-open `[start,end)`. For internal silence `[s,e)`, remove `[s + afterSpeech, e − beforeSpeech)`. Leading silence has no preceding-speech padding; trailing silence has no following-speech padding. Drop removals shorter than 100 ms after padding. Snap starts forward and ends backward to actual video-frame boundaries; drop again if shorter than 100 ms. Clamp/merge valid overlapping intervals and reject malformed values. Derive a single ordered kept-range list for both video and audio.

Example: silence `[10,12)` with 150 ms after and 100 ms before leaves removal `[10.150,11.900)`, or 1.750 seconds, before frame snapping. Settings changes mark analysis stale; new analysis remains undoable. All-silent input must be recoverable by restoring content but cannot export an empty video.

## Components and persistence

Separate media inspection/decoding, amplitude/VAD analysis, pure editing domain, rendering/validation, project storage, and AI adapters. Browser processing runs through the local server; Electron supplies native file access around the same core.

Store source SHA-256 identity and editing metadata in versioned JSON, not credentials or original media. Reconnect and verify sources/assets when reopening; never silently apply cuts to a different file. Persist original source-time values, and derive edited timing on demand. VFR uses actual PTS rather than average fps. Output one selected audio track with continuous audio assembly and one final AAC encode.

Handle no audio, unsupported/damaged files, all removed/no silence, stereo, music mixed with speech, missing tools, full disks, denied writes, cancellation, and atomic replacement. Never overwrite a source or label a partial/corrupt output successful. Full decode, duration, selected tracks, and independent A/V markers establish media correctness.

## Optional AI contract

AI proposes changes rather than arbitrary commands. Show selected provider/model and distinguish configuration saved, authentication checked, and actual valid inference. Requests may describe settings such as pauses longer than 0.7 seconds with speech margins. Later tasks use selected captions/terms/styles/effect metadata. Do not automatically upload complete original media, execute shell instructions, or give unrestricted file/tool access.

| Connection | Contract |
| --- | --- |
| Ollama | Local installed model, no fallback |
| OpenAI / Anthropic API | Explicit model and API key; do not assume chat subscription includes API billing |
| ChatGPT MCP | Official supported account path and HTTPS/tunnel setup must be verified; local installation alone is insufficient |
| Claude CLI/SDK | Supported official authentication/plan must be verified separately from mocks |
| Manual chat exchange | Copy request/import validated JSON; distinguish from direct integration |

Missing auth, quota, provider errors, and cancellation preserve edits and allow recovery without silent provider changes. Bound data and operations; revalidate proposals against current snapshots, reject stale/duplicate/invalid targets, and apply only selected changes with undo.

References recorded during initial planning: [FFmpeg silencedetect](https://ffmpeg.org/ffmpeg-filters.html#silencedetect), [Ollama API](https://docs.ollama.com/api), [ChatGPT MCP connection](https://developers.openai.com/plugins/deploy/connect-chatgpt), and [Claude plan integration](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan). Actual account availability requires current verification; these links are not evidence of a working user connection.

## Delivery and acceptance

Progress through domain/oracle preparation, actual media engine, complete browser/native workflow, then optional AI and later editing features. Required outcomes are deterministic rules, zero clipped speech on independent evaluation, synchronized actual outputs, restorable/undoable edits, reproducible project saves, preserved sources and completed files under failure, offline core operation, and measured time/resource targets.

Use [validation definitions](../../plans/2026-09-05-validation-plan.md) and [test cases](../../plans/2026-09-05-test-plan.md) for numeric gates and evidence. A working preview or synthetic pass does not mean all completion criteria are satisfied. Human quality, actual provider behavior, and native distribution must be judged separately.
