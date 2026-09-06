# Local transcription download cancellation and recovery

2026-09-06. Tested download lifecycle with a loopback server serving 131,089 synthetic bytes, temporary files, and real child processes. Did not rebuild or replace the installed model, runtime, or Mac package.

Original `sha `/` download ` functions extracted from ` 6f8e5ec ` left one `.download ` file after SIGINT following actual writes; the completed target survived. Preserve original/extracted/driver hashes and reproduction. Extract the downloader to ` scripts/helpers/verified-download.mjs`, propagate AbortSignal through download/hash verification, and handle SIGINT/SIGTERM during downloads with stream/temp cleanup and exit codes 130/143. Retain fixed hash/size limits, write/sync/reread verification, then rename.

Post-rename cancellation preserves the new verified file; next run verifies/reuses with zero requests. SIGKILL cannot run cleanup: preserve its leftover temporary file and use a fresh one on retry.

The final frozen-old-driver comparison covered 13 scenarios (12 new behavior plus one old reproduction), reported by Node as **14 PASS including the parent**, zero failures/cancels/skips. Ordinary execution without the old driver runs 12 scenarios and records old comparison NOT_RUN.

| Condition | Observed behavior |
| --- | --- |
| Initial install/replacement/reuse | Matching bytes/hash; zero requests on reuse |
| Wrong hash/oversize/503/interrupted body | Preserve target, remove own temporary file, no false success |
| Timeout/pre-abort | Preserve target, clean streams; zero pre-abort requests |
| SIGINT/SIGTERM | Exit 130/143, connection closed, no own temp before retry, retry hash matches |
| SIGKILL | Preserve target and leftover; new request succeeds without adopting/deleting leftover |
| Cancel after replacement | Preserve verified file, canceled exit, next run reuses without HTTP |

An initial test-driver Promise did not keep the event loop alive and exited 13; adding a bounded live timer fixed the harness. Preserve that failure. `npm run test:download` uses a fresh output directory and rejects existing explicit destinations. This covers T05 download conditions only, not real remote servers, CMake/process-tree install cancellation, clean-Mac setup, or atomicity of all setup. Product inference/edit/export code unchanged.

## Evidence and related records

- [2026-09-06-model-download-recovery-plan.md](../plans/2026-09-06-model-download-recovery-plan.md)
- [2026-09-06-model-download-recovery.json](results/2026-09-06-model-download-recovery.json)
