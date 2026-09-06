# Native save interruption and reopening

Executed 2026-09-05 America/New_York. Package contains end-boundary fix `1e927ff`; documentation baseline `674e72d`. Raw evidence preserves package/runner SHA-256.

| SIGKILL point | Final project | Reopened result |
| --- | --- | --- |
| After temporary write/fsync, before rename | Byte/hash-identical old file, threshold −40 | Source reconnect, complete field comparison, resave PASS |
| After real rename, before IPC success | Byte/hash-identical new file, threshold −41 | Full round trip, unreviewed SRT blocked, resave PASS |

Both used actual packaged buttons/IPC/write/fsync/rename. All five tracked app/child processes terminated. Before termination the dirty flag remained and no save-success message appeared. A fresh app reopened the preserved project and matched cuts/captions/style/glossary/end review, then saved a further −42 edit. Source hashes remained unchanged; zero page errors/observed external requests. Sandbox/contextIsolation/webSecurity stayed enabled and nodeIntegration disabled. Screenshots confirmed dirty state and pre-save settings.

Only file-dialog paths were substituted. Test barriers controlled before/after rename delivery, not serialization/validation/writing. Before-rename SIGKILL left one complete temporary file; the app did not auto-adopt it and reopened the prior completed file. After-rename left no temporary file. Only test-generated directories were cleaned.

This satisfies the native whole-app save-kill/reopen portion of E03, not power-loss durability, browser download completion, or actual OS replacement confirmation E04. No product fix was needed.

```sh
node scripts/desktop-save-crash-e2e.mjs --output=test-output/FRESH_RUN_NAME
```

Preserve earlier output directories when repeating.

## Evidence and related records

- [2026-09-05-desktop-save-crash-plan.md](../plans/2026-09-05-desktop-save-crash-plan.md)
- [2026-09-05-desktop-save-crash.json](results/2026-09-05-desktop-save-crash.json)
