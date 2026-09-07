# Cloud beta implementation and verification plan

1. Extract shared job validation/execution without changing local API behavior.
2. Add SQLite persistence, operator account provisioning, session authentication and ownership boundaries.
3. Implement durable resumable uploads, versioned portable projects and a bounded persistent job queue.
4. Add an independently runnable worker with cancellation, interruption recovery and export registration.
5. Integrate runtime routing, login/project dashboard, server saves and reconnectable results into the existing editor.
6. Package a single-host Docker deployment and document development, operations, API and extension boundaries in English.
7. Run focused security/recovery integration tests with real FFmpeg media, existing local regression checks and browser acceptance. Record verified scope and outstanding external deployment separately.
