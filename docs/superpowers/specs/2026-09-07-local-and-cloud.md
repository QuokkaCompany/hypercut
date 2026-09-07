# Independent local editing and a self-hosted cloud beta

Status: implemented as a single-host beta; see [validation results](../../testing/2026-09-07-cloud-beta-results.md).

HyperCut keeps its offline desktop and loopback browser editions. A separate cloud entry point serves the same editor and media engine to authenticated users. No subscription or commercial infrastructure is required to self-host it.

The first cloud release is a single-host beta with durable SQLite metadata and a persistent filesystem volume. An API process handles authentication, resumable uploads, project revisions, media delivery and job submission. A separate worker executes the existing FFmpeg, Silero and Whisper operations. Closing a browser or restarting the API must not discard projects or queued jobs. Interrupted worker jobs fail visibly and can be retried explicitly.

Accounts are provisioned by the operator. Cookie sessions, CSRF checks and ownership checks apply to every asset, project, job and output. File and account quotas bound uploads. AI connections are optional and session-scoped; cloud clients cannot invoke the operator's local Ollama or Claude CLI account. The local edition retains those integrations.

Projects use the existing portable JSON schema. Explicit server saves use optimistic revisions; concurrent edits return a conflict instead of silently overwriting another tab. Jobs record an immutable input and project revision. A completed analysis or transcription can be applied after reconnecting only when its base revision still matches.

Resumable uploads retain committed chunk hashes and offsets. A reselected file must match retained chunks before upload resumes. Files live under generated IDs, never client-supplied paths. Users can remove their projects, files and outputs when no active job references them.

The cloud editor must state that media is uploaded to the host. Local processing messages remain accurate in the local edition. Authentication and the project dashboard use English; existing editor localization is retained.

Not included: public registration/email, billing, hosted infrastructure, multi-host coordination, S3, GPU scheduling, collaboration, automatic project merging or automatic AI spending. These are future extensions, not beta capabilities.

## Acceptance

- Existing local API, media and project race checks still pass.
- Two users cannot read or mutate each other's records or files.
- Upload resume, digest mismatch, quotas, idempotency and revision conflicts have executable tests.
- Real media analysis and export complete in a separate worker; downloaded output decodes and source hash stays unchanged.
- API restart preserves sessions, projects, uploads and jobs; browser reconnect exposes results.
- Worker interruption and cancellation have explicit terminal states.
- Browser login, upload, edit, save, reconnect and export are verified.
- English setup, architecture, API and limitations documentation describe tested behavior precisely.
