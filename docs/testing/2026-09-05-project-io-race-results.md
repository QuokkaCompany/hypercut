# Preserving edits against late project reads and saves

Executed 2026-09-05 America/New_York after baseline `626f116`. Raw records identify product/package/runner hashes.

Both apps let late A reads overwrite latest B or edits made while reading, clearing dirty state. Thresholds distinguished A −60, B −50, later edit −42. Native save correctly wrote its −41 snapshot, but late completion cleared dirty state after a −42 edit or switching/editing B, falsely implying the newer state was saved.

Track selection order, project identity, and edit revision. Ignore obsolete read success/errors; preserve edits made while reading and ask for a new selection. Apply sequencing to source/sample loads too. On native completion, compare saved project/revision: retain dirty state for newer edits and label old-project saves separately. Prevent duplicate button/shortcut saves and protect window close while saving; clear active-save state after cancel/error for retry.

| Condition | Before | After |
| --- | --- | --- |
| Latest B survives late A | Both FAIL | Both PASS |
| Old A read error after B | NOT_RUN | Both PASS |
| Current edit during A read | Both FAIL | Both PASS |
| Edit same project while saving | Mac FAIL | Mac PASS |
| Switch/edit project while saving | Mac FAIL | Mac PASS |

Six pre-fix failures; **eight post-fix PASS**. Save cases also checked disabled controls/shortcut deduplication. SAVE_EDIT added source-destination rejection with dirty/source/retry preservation; these added checks were not retroactively counted before the fix.

Waited until renderer completion notification before checking dirty state, not merely while IPC was pending. Compare saved snapshot and current full project separately, then save the latest edit again. Zero source changes/page errors/observed external requests; viewed Mac dirty/completion state.

Additional: 75 units, type/build/package, and 11 runs across six regression flows: both-app core/save cancel, browser delayed analysis/AI, two native before/after-rename SIGKILLs, both-app glossary, actual Whisper/caption/style/SRT/MP4, and end-review/output block/save. TTS is not human quality or authenticated LLM evidence.

Tests delay actual generated `File.text()` results, inject one read exception, and hold native actual IPC/serialization/write/fsync before rename. OS replacement prompts, all canceled-analysis/source races, and browser download completion are separate; not all E06. Earlier long transcription results remain tied to `1e927ff`, not retroactively to this I/O change.

```sh
npm run test:project:io -- --output=test-output/FRESH_RUN_NAME
```

Use generated media/temporary projects only and preserve old result directories.

## Evidence and related records

- [2026-09-05-project-io-race-plan.md](../plans/2026-09-05-project-io-race-plan.md)
- [2026-09-05-project-io-races-before.json](results/2026-09-05-project-io-races-before.json)
- [2026-09-05-project-io-races-after.json](results/2026-09-05-project-io-races-after.json)
- [2026-09-05-project-io-regressions.json](results/2026-09-05-project-io-regressions.json)
