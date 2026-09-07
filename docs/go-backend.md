# Go backend

HyperCut uses one Go implementation for the local API, cloud API and durable worker, media processing, caption rasterization, AI providers and scoped MCP server. React/TypeScript runs in the browser; Electron's JavaScript adapter handles windows, dialogs and IPC and launches the same Go binary. No production backend JavaScript is loaded or interpreted.

## Build and run

Development requires Go 1.26+, a C compiler, Node 22.12+ (24+ for legacy SQLite reference tests), and FFmpeg/ffprobe. Run `npm ci`, `npm run build`, and `npm run build:server`. The last command builds `.cache/bin/hypercut-cloud` and copies a standalone, platform-matched ONNX Runtime library into `.cache/native/`. Its pinned development dependency is used as a library distribution source, not as a runtime Node binding.

The prepared binary supports:

```sh
.cache/bin/hypercut-cloud local
.cache/bin/hypercut-cloud serve
.cache/bin/hypercut-cloud worker
.cache/bin/hypercut-cloud healthcheck
```

`user <email>` accepts an account password on stdin; `mcp` accepts the app-issued environment for one scoped share. `npm start`, `npm run cloud:api` and `npm run cloud:worker` are build-and-launch conveniences. Run the prepared binary directly to avoid Node at runtime. Do not run two APIs against one cloud data directory.

Keep `dist/`, `assets/` and the native library with the binary. Set `HYPERCUT_ROOT` to that resource directory and, if necessary, `HYPERCUT_ONNXRUNTIME_LIBRARY` to the platform library. `FFMPEG_PATH` and `FFPROBE_PATH` override tool discovery. `npm run setup:transcription` prepares the pinned whisper.cpp executable and multilingual small model; `HYPERCUT_TRANSCRIPTION_DIR` selects their location. These C/C++ libraries/tools implement codecs and inference; Go owns the backend behavior and process lifecycle.

Docker uses Go and Node build stages and a Debian runtime stage without Node, npm, node_modules or legacy server files. API and worker run the Go executable. The desktop package places its Go binary, models, fonts and native library under `Contents/Resources/backend/`. FFmpeg/ffprobe remain external prerequisites for desktop users.

## Module ownership

| Module | Responsibility |
| --- | --- |
| `internal/local` | Loopback trust boundary, uploads, jobs, protected atomic desktop saves |
| `internal/cloud` | Authentication, SQLite, resumable uploads, project revisions, quotas, durable worker leases |
| `internal/media` | Media inspection, PCM silence analysis, timeline, Silero, Whisper, captions, effects, export verification |
| `internal/ai` | Ollama/OpenAI/Anthropic/Claude CLI, proposal validation, cancellation, share leases, MCP stdio |
| `desktop` | Electron UI adapter; no editing engine |
| `tests/reference/server` | Former JavaScript implementation used only as an independent test reference |

The portable project schema remains v8. Existing cloud schema v1, account hashes, session cookies, queued inputs and upload offsets remain compatible. Stop API and worker and back up their shared directory before upgrading. Return to a known release and consistent backup for operational rollback; the reference server is not shipped as a supported alternative runtime.

## Verification

```sh
npm test                          # Browser/shared and reference unit tests
npm run test:server               # Native Go tests with race detection
npm run test:api                  # Go local HTTP + MCP and native AI tests
npm run test:cloud:go             # Go API + Go worker; persistence compatibility
npm run test:local:go:e2e          # Browser editing against Go
npm run test:cloud:go:e2e          # Cloud browser against Go API + worker
npm run test:reference:media      # Independent legacy media behavior
```

`internal/media/testdata/browser-contract.json` captures 36 deterministic cases for frame snapping, restoration, source ranges and caption review keys. Regenerate with `node scripts/go-parity-fixtures.mjs`; review changed expectations when modifying shared browser contracts. Go consumes the fixture without running JavaScript.

Native AI tests use fake HTTP transports and a disposable CLI process, not paid providers. Real MCP integration starts the Go stdio process and tests four task types, scoped capabilities, retry identity, application receipts, limits and expiry. The opt-in `HYPERCUT_GO_SPEECH_FIXTURE=/absolute/speech.mp4 go test ./internal/media -run TestActualSpeechAndTranscription -count=1` uses prepared real Silero and Whisper components. The default test skips this model-dependent case explicitly when the fixture is absent.

See the [recorded migration checks](testing/2026-09-07-all-go-backend-results.md). Reference-only tests are not evidence that a Go feature passed. Rasterization now uses Go's font engine; layout and readable multilingual output are tested, but pixel identity with the former canvas renderer is not promised. Signing/notarization, clean-machine installation, human speech quality, paid provider authentication and multi-host cloud operation require separate validation.
