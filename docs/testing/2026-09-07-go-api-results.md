# Go cloud API validation — September 7, 2026

## Scope

The default cloud HTTP API is now Go. It owns public request boundaries, authentication/session storage, resumable uploads, project revisions, queue submission/cancellation/application and owned file serving. A private Node helper retains the shared media validators, inspection, playback, caption previews and optional AI adapters. The existing Node worker executes durable media jobs. The independent local edition is unchanged.

The candidate was developed on branch `codex/go-cloud-api` from main `57e738e`. Local checks used macOS arm64, Go 1.26.5 and Node 24.14.1. The Docker image uses Linux arm64, a compiled Go binary and the Node 24 runtime, FFmpeg, CPU Silero and the pinned Whisper small model. No paid inference was invoked.

## Executed checks

| Check | Observed result |
| --- | --- |
| Existing unit suite and production frontend build | 97 tests passed; build passed |
| Independent local API/AI API regressions | 12 passed |
| Original Node cloud integration suite | 12 passed |
| Same cloud integration suite against Go | 12 passed, including source hashing, owned range reads, quota limits, effects, real MP4 export/decode, cancellation, worker death/retry and session-scoped AI configuration |
| Node → Go → Node → Go migration | Passed: live session cookie, partly uploaded file, project, queued job and applied result survive; Go-created account authenticates in Node |
| Go tests with race detector | Five test functions passed: atomic concurrent reservations, auth/session expiry and rollback, future-schema rejection, HTTP/static/body boundaries and helper-crash failure behavior |
| `go vet ./...` | Passed |
| Browser acceptance against Go | Passed: login, upload, analyze, restore/save, portable JSON, reload, export after tab closure, downloaded-file decoding, mobile overflow checks and logout |
| Docker build and Compose startup | Passed with the Go API command and an independent Node worker; API runs without root on a read-only root filesystem |
| Actual Linux CPU media/AI smoke | Passed: Go account CLI and runtime identity, authenticated upload, three Silero speech intervals, actual Whisper transcription, TXT download, caption image preview and captioned MP4 |

The generated English speech produced two cues. The downloaded captioned MP4 had two burned-in captions, a 9.367-second duration, and passed complete FFmpeg decoding. Synthetic speech is a controlled pipeline fixture, not a human-transcription quality benchmark. Private generated source audio and outputs remain under ignored temporary/evidence paths and are not published.

## Reproduction

```sh
npm ci
npm test
npm run build
npm run test:api
npm run test:cloud
npm run test:server
go vet ./...
npm run test:cloud:go
npm run test:cloud:go:e2e
docker build -t hypercut-cloud:go-validation .
```

The optional container smoke script, `scripts/cloud-container-smoke.mjs`, must run only with the disposable `hypercut-beta-validation` Compose project on loopback port 4328. It creates a generated sample and a temporary test account in that project's volume. It requires macOS `say` and a running container with Whisper. Its JSON result and MP4 are in ignored `test-output/cloud-container/`. Remove only that disposable project's resources after collecting evidence.

## Limits

This is a Go API migration, not a full media-engine rewrite. Node remains required for the private helper and worker. The Go transport currently targets macOS/Linux Unix sockets; Windows, multi-host operation, GPU scheduling and public SaaS deployment are not validated. No speed or memory improvement is asserted. Existing human-quality, long-video, clean-Mac packaging and actual paid-provider validation limits still apply. In-memory AI connections are cleared on API restart and must be reconnected.
