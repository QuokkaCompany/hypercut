# Cloud API contract (beta)

All routes are same-origin under `/api`. Except runtime, health and sign-in, every route requires a valid `hypercut_session` cookie. Mutations also require `X-Hypercut-Token` from sign-in, `/auth/me` or `/config`. A query-string token alone never authorizes a cloud read. Responses and errors are JSON unless returning a file. Unknown or foreign-owned objects return 404.

| Method and route | Request / response |
| --- | --- |
| `GET /runtime` | `{mode:"cloud",apiRuntime:"go"}` for the Go API; the original Node transport omits `apiRuntime`; local transport returns `local` |
| `GET /health` | API/database liveness; no account data |
| `POST /auth/login` | `{email,password}` → user, CSRF token; sets HttpOnly cookie |
| `GET /auth/me` | Current user and CSRF token |
| `POST /auth/logout` | Revokes this session and clears its AI connection |
| `GET /config` | Mode, tools, limits and CSRF token |
| `GET /uploads` | This account's incomplete upload states |
| `POST /uploads` | `{name,size,kind?}`; kind is `media` (default) or `effect`; reserves quota |
| `GET /uploads/:id` | Committed offset, ordered SHA-256 hashes, chunk size and completion result |
| `PUT /uploads/:id/chunks/:offset` | Binary `application/octet-stream`, `X-Content-SHA256`; offset in bytes |
| `POST /uploads/:id/complete` | `{}` → registered media/effect; safe to repeat after success |
| `DELETE /uploads/:id` | Discards an incomplete upload and releases its reservation |
| `GET /media`, `GET /media/:id` | Registered video metadata |
| `GET /media/:id/file?trackIndex=N` | Authenticated video stream with byte-range support |
| `GET /effects` | Registered effect metadata |
| `DELETE /media/:id`, `DELETE /effects/:id` | Refused while saved projects or active jobs reference the asset |
| `GET /projects`, `GET /projects/:id` | `{id,name,mediaId,data,version,createdAt}`; data is portable project JSON |
| `POST /projects` | `{name,mediaId,data}` → revision 1 |
| `PUT /projects/:id` | `{name,mediaId,data,version}` → next revision; stale version returns 409 |
| `DELETE /projects/:id` | Removes saved project; keeps source; active project jobs must finish/cancel |
| `POST /jobs` | Shared job input plus optional projectId/baseVersion; returns 202 and job ID |
| `GET /jobs`, `GET /jobs/:id` | Queued/running/completed/failed/cancelled state, progress and result |
| `DELETE /jobs/:id` | Requests cancellation; poll until terminal state |
| `POST /jobs/:id/apply` | Applies completed analyze/restore/transcribe result to matching base project revision |
| `DELETE /jobs/:id/record` | Dismisses a terminal job; outputs remain available |
| `GET /exports` | Owned output metadata |
| `GET /exports/:id?download=1` | Downloads an output; without download flag it can be previewed |
| `DELETE /exports/:id` | Removes an output file and releases accounted bytes |
| `GET /transcription/status` | Installed model/runtime readiness |
| `POST /captions/style-preview` | `{mediaId,text,captionStyle,language?}` → caption image/layout |
| `GET/POST/DELETE /ai/connection` | Session-local connection; POST accepts only openai/anthropic |
| `POST/DELETE /ai/proposal`, `/ai/correction`, `/ai/translation`, `/ai/effects` | Existing structured proposal/cancellation contract; explicit requests only |

## Upload integrity

Each chunk is exactly `min(chunkBytes, size-offset)` bytes. Offsets must match the committed offset or a previously committed chunk with the same digest. Obtain server state after an uncertain response. Before resuming a reselected file, verify every committed chunk digest against that file. Completion never trusts client media duration, codec or fingerprint.

## Job input and lifecycle

A job has `requestId` (UUID), `type`, `mediaId`, `trackIndex` and type-specific input. Analyze requires silence `settings` and optional `speechProtection`. Export/preview/restore use `cuts`; export/preview optionally use source `range`, captions and effects. Transcribe uses `{channel,language}`. Captions/transcript use a validated transcript, with `textMode` equal to `source` or `edited` for TXT. See `server/engine.mjs` and shared validators for exact bounds.

Use one requestId for retries of the same submission. Reusing an ID with different input returns 409. After a failed/cancelled job, an explicit retry uses a new ID. Cancellation that arrives before creation is retained for the same account so a late submission does not start. Queued work is durable; active work is fenced by a worker attempt and lease. API restart does not cancel worker jobs.

An editable result is applied only when the project still has `baseVersion`. A successful apply advances the revision and is idempotent. A mismatched version returns 409 and preserves newer edits. Export results are immutable files and do not replace project editing state.

Errors include 400 invalid input, 401 missing/expired login, 403 host/origin/CSRF rejection, 404 missing or inaccessible record, 409 conflict, 413 upload/storage limit, 429 concurrency/record/sign-in limits and 503 when the Go API's private helper is unavailable. Native worker failures appear in terminal job state. Public URLs, stable v1 API versioning and generated OpenAPI clients are future work.
