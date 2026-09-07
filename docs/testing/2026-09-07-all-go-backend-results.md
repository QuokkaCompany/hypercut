# Complete Go backend migration checks — 2026-09-07

Scope: local/cloud API, durable worker, media engine, native captions, AI adapters and MCP. Browser UI and Electron dialogs remain JavaScript/TypeScript. Tests ran on Apple Silicon macOS and an arm64 Debian container; no paid provider requests were made.

| Check | Result | Evidence boundary |
| --- | --- | --- |
| `npm run build`, `go vet ./...` | PASS | Frontend type/build checks and Go static analysis |
| `go test -race ./...` | PASS | Native Go API/store, AI transports, cancellation, shares, CLI environment/process cleanup, local authority/atomic saving, real FFmpeg/captions |
| `npm run test:api` | PASS: 17 integration cases plus Go AI tests | Go local HTTP and real Go MCP stdio; one adapter-configuration case remains a reference assertion |
| `npm run test:cloud:go` | PASS: 13 cases | Go API + Go worker; owner isolation, resumable uploads, projects, restart, cancellation, worker crash/retry, quotas, real export/effects and legacy persistence compatibility |
| `npm run test:cloud:go:e2e` | PASS | Browser login/upload/analyze/save/reload/edit; export after tab closure, download/full decode, mobile workspace and logout |
| `HYPERCUT_LOCAL_SERVER=go node scripts/e2e.mjs` | PASS | Browser playback, silence cuts, undo/restore, project round trip, source mismatch rejection, preview/export, no external requests or page errors |
| `HYPERCUT_LOCAL_SERVER=go node scripts/e2e.mjs --desktop --packaged` | PASS | Packaged Mac app and bundled Go child; native IPC, original overwrite rejection, decoded output, cancelled/successful project save; dialogs are test-controlled |
| Independent Go A/V sync | PASS: CFR, VFR and nonzero timestamp sources | Real flash/beep markers; audio within 5 ms, video within one frame; full output decode |
| Browser timeline/caption contract | PASS: 36 cases | 24, 30 and 30000/1001 fps; cut/range/restore decisions and Unicode caption review keys |
| Real model test | PASS | Synthetic Samantha speech; native Silero and pinned Whisper small; captioned MP4 and full decode |
| Linux runtime smoke | PASS | Real CPU Silero/Whisper, TXT, caption PNG, captioned MP4/full decode; runtime has no Node executable, server directory or node_modules |
| `npm test` | PASS: 97 cases | Shared frontend and independent reference behavior; not native Go evidence |
| `npm run test:reference:media` | PASS | Legacy media oracle retained for independent comparison |

The package and downloaded exports were actually produced and decoded. Generated fixture media and detailed local artifacts live in ignored `test-output/` directories and are not committed as user recordings. Model-dependent Go tests explicitly skip when their opt-in fixture is absent.

Issues found and corrected during migration included local range-error feedback, MCP oversized-body status, missing MCP output schemas/annotations, ECMAScript-incompatible UUID patterns, primary/fallback font selection, Unicode review-key serialization, older project field handling, and desktop original-save feedback. Failed desktop assertions now dismiss the test app's unsaved-change dialog during cleanup.

Not established: signed/notarized distribution, clean-Mac installation, Windows support, human-recording quality, authenticated paid OpenAI/Anthropic or real Claude subscription execution, long-session performance parity, pixel identity with the former caption rasterizer, production SaaS deployment, or distributed/GPU operation. CI status is tracked on the migration PR separately from this local record.
