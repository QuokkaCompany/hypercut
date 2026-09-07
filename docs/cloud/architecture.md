# Architecture and contribution boundaries

```mermaid
flowchart LR
  Local[Local browser or Electron] --> Loopback[Local API]
  Cloud[Authenticated cloud browser] --> API[Go cloud API]
  API --> DB[(SQLite metadata and queue)]
  API --> Files[(Persistent files)]
  API --> Helper[Private Node media helper]
  Helper --> Engine
  Worker[Node cloud worker] --> DB
  Worker --> Files
  Loopback --> Engine[Shared media job engine]
  Worker --> Engine
  Engine --> Media[FFmpeg / Silero / Whisper / caption renderer]
```

`server/engine.mjs` owns job validation and execution. It delegates to the existing media, speech, caption and effects modules. `server/app.mjs` preserves the independent loopback API and in-memory local job lifecycle. `cmd/hypercut-cloud` and `internal/cloud/` implement the default authenticated Go transport. `server/cloud/app.mjs` remains the original Node transport for rollback and contract comparison. Changing one transport must not weaken the other's boundaries.

`internal/cloud/store.go` owns Go SQLite/account/session primitives; `server/cloud/store.mjs` retains the compatible implementation for the worker and original API. Both use schema version 1, the same scrypt parameters and hashed cookie identities. Metadata is stored in owner-indexed records, with short `BEGIN IMMEDIATE` transactions for reservations, project versions, queue claims and result publication. WAL supports the API and worker on the same local filesystem. Database paths and original filenames are never accepted as job source locations.

`server/cloud/media-bridge.mjs` is started by the Go API on a private Unix socket under a mode-0700 directory. It provides bounded media inspection/validation, playback, caption preview and session-scoped AI operations, with no public listener or metadata store. Go checks ownership and passes resolved records into existing JavaScript validators. It never accepts a browser-supplied media path. Request cancellation propagates to the helper's native processes; a stopped helper makes API readiness fail and media calls return a service error. Restart the API to recreate it. The Go binary still needs Node and the media assets for these operations.

`internal/cloud/uploads.go` accepts 8 MiB chunks, checks SHA-256, syncs files and their directory before committing offsets and uses generated upload directories. A duplicate chunk is accepted only if its committed hash matches. Completion assembles and inspects the media, then publishes an owned asset and idempotent result in one metadata transaction. Abandoned parts remain visible for explicit removal. Container/codec validation rejects playlists and unsupported sources.

`internal/cloud/jobs.go` stores immutable job input and the optional project revision. Supported jobs are analyze, restore, transcribe, preview, export, captions and transcript. `server/cloud/worker.mjs` claims a queued job transactionally, heartbeats its lease and executes in a unique attempt directory. Cancellation sets a persistent flag. Only the current attempt can commit a completed result. Expired attempts become failed rather than being automatically replayed. The Go and Node APIs share these contracts and are exercised by the same integration/browser scenarios.

`src/Cloud.tsx` routes runtime mode and provides sign-in, a workspace and cloud save callbacks. `src/App.tsx` remains the editing UI. Before submitting a cloud job it persists the project snapshot, then uses the same media job contract as the local edition. `src/api.ts` handles session CSRF tokens, resumable cloud uploads and queued/running polling. Cloud mode reports server processing in the editor.

## Portability and future work

Both editions use portable project schema v8 and the same cut/caption/effect validators. Cloud record IDs and revisions wrap the portable document rather than changing its format. A contributor can improve silence decisions, caption mapping or export behavior once and exercise both transports.

The filesystem and SQLite modules are concrete single-host implementations. They are not an S3 or distributed queue abstraction masquerading as a finished implementation. A future multi-host change needs object storage, transactional queue claims across hosts, input/output lifecycle rules, worker fencing, migrations, backups and new cross-host failure tests. GPU scheduling also needs explicit resource limits and deployment-specific validation.

Do not add cloud-only editing feature gates. Authentication, storage, operations and future billing belong around the engine; offline editing should continue to work without an account or network service.
