# Complete Go backend

## Authorized scope

Replace every production Node server component: cloud media helper, durable worker, local HTTP server, AI integrations and MCP service. Keep the browser/Electron presentation layer and JavaScript development/test tooling. FFmpeg, ffprobe, whisper.cpp and native inference/rendering libraries remain external engines; no server operation may require Node or evaluate JavaScript.

## Architecture

A common Go media package owns validation, source inspection, sample-accurate silence detection, frame-aligned edits, transcription, caption/effect composition and verified output. Cloud and local adapters invoke it directly. Cloud preserves the existing SQLite schema and tenant/lease boundaries. Local preserves the existing HTTP and portable project contracts and explicit file grants. Go AI adapters retain proposal validation, session isolation and explicit provider selection. Native desktop code launches the Go executable and remains responsible for dialogs.

The selected approach is a direct Go port with contract tests. Keeping a Node bridge would violate the requested scope. Embedding a JavaScript interpreter would merely hide that dependency. Replacing the editor UI is unrelated and would enlarge the regression surface.

## Safety and compatibility

Preserve original media, cancellation, atomic publication, source-time mapping, multilingual captions, restore/save and output verification. No automatic fallback to legacy Node execution. Retain legacy JavaScript only as test reference until parity is established. Do not claim native-package or human-quality acceptance from browser tests.

## Completion gates

Run Go race tests; original API/cloud contracts against Go; browser and desktop adapter flows; actual VAD, Whisper, captions/effects and full MP4 decode; local AI/MCP mock/failure contracts; migration and restart recovery. Build a production container without Node and run upload/analyze/transcribe/export through it. Scan production launch/package paths for Node server imports. Document unsupported or unverified conditions explicitly rather than deleting features or silently changing behavior.
