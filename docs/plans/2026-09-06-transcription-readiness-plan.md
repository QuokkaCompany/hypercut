# Local transcription readiness and recovery

2026-09-06. Refine T05's distinction between missing/corrupt models and unsupported runtimes. `transcriptionStatus` previously collapsed failures into one setup message. Passing size/version checks is not a completed model-hash check.

Return distinct reason codes and actionable UI messages for missing/non-file/unreadable/non-executable engine, missing/non-file/wrong-length/unreadable model, unsupported version, process failure, and timeout. Do not expose raw OS paths/stderr. Offer model setup, permission checks, compatible reinstall, and retry; keep developer installation commands in documentation.

Preserve successful `ready`, `model`, `engine`, `local`, and `integrity` fields. Status checks file type/access/size/version; full SHA-256 occurs before actual transcription. Accept pinned `1.9.3` and packaged `1.9.3-dev`, including the `whisper.cpp version: ` prefix; reject lookalikes such as `1.9.30`. Propagate cancellation rather than converting it to error status. Retain ten-second process timeout/cleanup and no automatic cloud fallback/download. Status checks must not mutate media/models/captions/cuts; manual caption editing and saving remain available.

| Case | Evidence |
| --- | --- |
| R01 | Distinct missing engine/model; avoid unnecessary engine launches |
| R02 | Distinct non-file, wrong-length, read/execute permission errors; preserve files |
| R03 | Supported, unsupported, and misleading-prefix versions |
| R04 | Real process failure without path/stderr leakage into UI |
| R05 | Actual ten-second timeout and canceled child cleanup |
| R06 | Status does not claim hash integrity; same-sized corrupt model rejected before inference |
| R07 | Authenticated API retains reasons; unauthenticated requests rejected |
| R08 | Both apps: missing→repair→recheck, preserved captions/project, actual inference retry |

Use actual filesystem and small test-owned engine processes; sparse files validate length only, not model integrity/inference. Preserve installed engine/model. Record pre-fix behavior, repeat after changes, then regress real transcription and both-app recovery. Mock engines are not Whisper or accuracy evidence.

Finish/audit the ongoing `86a5c4d` 60-minute warm three-run test before changing product/bundle/package. Only plans and app-independent test preparation may proceed meanwhile. Readiness changes create a new candidate; retain earlier measurements for their original build and run the remaining matrix afterward.
