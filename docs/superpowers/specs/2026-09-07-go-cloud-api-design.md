# Go cloud API

## Decision

Move the authenticated cloud HTTP API, account/session handling, upload persistence, project metadata and job submission to Go. Preserve the existing SQLite schema and browser contract. Keep the Node media worker and independent local edition operational. The result is a Go API with a separate media runtime; it is not a Node-free distribution.

Alternatives considered: a complete Go rewrite would also replace the shared JavaScript timeline validators, ONNX bindings and caption renderer, widening the regression surface. A Python API would make future Python model integration convenient but would not itself accelerate FFmpeg or Whisper. A Go API with the existing worker gives contributors a clear server boundary while retaining tested editing behavior. A future Python worker can implement the same persisted job/result contract when a model needs it.

## Boundaries

Go owns public HTTP, security headers, host/origin validation, sessions and CSRF, account limits, resumable upload records, project versions, queue submission/cancellation/result application, authenticated file streaming and static editor delivery. Use standard net/http and a pinned SQLite driver. Existing password hashes, cookies, records, schema version and reservations remain compatible with Node.

A child Node process exposes a narrow private Unix socket in a mode-0700 temporary directory. It performs media inspection, portable-document/job validation, playback preparation, caption style previews and session-scoped optional AI calls. It has no public listener and does not own cloud metadata. Go supplies only server-resolved media and effect records after ownership checks. Requests have bounded bodies, timeouts and cancellation. Credentials remain in memory and are cleared on logout or process exit.

The existing durable worker continues to claim jobs in SQLite, run FFmpeg/Silero/Whisper/caption operations and publish fenced results. It can run independently of the Go API. Docker's default API command becomes the Go binary; the worker command remains explicit. The local browser/Electron edition keeps its existing independent runtime.

## Failure handling and compatibility

Preserve authenticated range requests, chunk hash verification and committed-offset retries, atomic quota reservations, revision conflicts, request-ID idempotency, cancellation tombstones, lease recovery, owned effect validation and export deletion rules. Closing the Go API terminates its private helper and waits for in-flight requests. A crashed helper causes a bounded service error rather than exposing another user's data or silently accepting unvalidated input. Restarting the API restores sessions, uploads, projects and queued jobs from the existing database.

Use one API process per cloud data directory as in the existing beta. No new registration, billing, hosted deployment, distributed storage or performance claims are introduced.

## Acceptance

- Run Go tests with race detection for storage/authentication, request boundaries and lifecycle behavior.
- Run the existing cloud integration suite against Go, including restart/resume, ownership, quotas, idempotency, cancellation, worker recovery, effects and actual FFmpeg output.
- Run browser acceptance against Go without changing editor behavior.
- Verify a real Whisper/captioned export through the Go API and decode the result.
- Keep existing local unit/build/API checks passing.
- Build the Docker Go API, document exact runtime responsibilities, and keep all new project documentation in English.
