# Cancellation responses versus the next project

Executed 2026-09-05 America/New_York. Four pre-fix cases on `a3d5b26` showed an obsolete cancellation HTTP error in the current project after either opening B/starting preview or editing A. This was stale error display, not observed loss of cuts/files.

Bind cancellation failure handling to both the initiating job object and operation sequence. Ignore finished/replaced jobs while retaining visible retryable failures for the current job.

Seven conditions × Chrome/Mac = **14 PASS**: pre-POST cancel; delayed real analysis; delayed actual MP4 completion; delayed old cancel success; delayed old cancel failure during B; old failure after later same-project edits; current failure and retry. B retained its source identity, one manual cut, −42 dBFS, dirty flag, new progress/result path, and no old MP4 save control. Its actual preview then rendered with B's result ID.

Every final saved field except timestamp matched, including captions/style/glossary/cuts/settings and empty effect lists. Both source hashes remained; zero page errors/observed external requests. Additional verification: 75 units, type/build/package, core both-app flow, browser delayed analysis/AI recovery, eight project-I/O races, and both-app real Whisper/caption/SRT/style MP4: 13 UI runs across four regression flows, not added to unit or plan-case counts.

Real server jobs supplied completion payloads; only delivery order and 503 faults were controlled. Open new media only after controls became enabled. `fulfill-resolved` after AbortController cancellation does not prove body consumption; late cancellation JSON reading was observed separately. Pre-canceled jobs were directly confirmed `cancelled` with no result. Current retry tests held UI completion after server work finished, not a fresh process-termination benchmark.

This covers named analysis/export/new-preview races, not every transcription/SRT/partial-restore/effect-editor combination or all E06. Native paths were substituted; actual OS prompts have separate evidence. Human Korean/time, authenticated LLM, native network blocking, and final long performance remained outstanding.

```sh
npm run test:jobs:races -- --output=test-output/FRESH_RUN_NAME
```

Use current browser/Mac builds. For original reproductions append `--scenarios=CANCEL_LATE_ERROR,CANCEL_AFTER_EDIT`. Preserve prior result directories.

## Evidence and related records

- [2026-09-05-job-cancellation-race-plan.md](../plans/2026-09-05-job-cancellation-race-plan.md)
- [2026-09-05-job-cancellation-before.json](results/2026-09-05-job-cancellation-before.json)
- [2026-09-05-job-cancellation-after.json](results/2026-09-05-job-cancellation-after.json)
- [2026-09-05-job-cancellation-regressions.json](results/2026-09-05-job-cancellation-regressions.json)
