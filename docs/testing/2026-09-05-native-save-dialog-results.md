# Actual Mac save and replacement dialogs

Executed 2026-09-05 America/New_York on packaged `16ad89f`: **five conditions PASS**. Generated 16-second source, old-settings project, and separate four-second MP4 only. After analysis: −41 dBFS, five cuts, output 9.066 s. Dedicated test profile/media folder; app closed afterward.

Only initial media selection was supplied then restored. Save-dialog functions/results were not substituted. Accessibility tools operated real macOS folder/name/Cancel/Replace controls, followed by actual write/fsync/rename.

| Condition | Result |
| --- | --- |
| Cancel project replacement and parent save dialog | Existing hash unchanged; dirty state/retry, no false success |
| Approve project replacement | Valid current v7, −41 dBFS/five cuts/source identity; dirty cleared |
| Cancel MP4 replacement and parent dialog | Existing MP4/source hashes unchanged; retry/no false success |
| Approve MP4 replacement | Same SHA-256 as render, 9.066 s, full decode PASS |
| Approve OS replacement at source.mp4 | App rejected original destination; source bytes preserved |

Final source SHA-256: `3bc4f5d13c7fadff9d0f6b09989d1279d79d899e1e04dce5a1a52895a270b3df`. Zero page errors/observed renderer external requests, not OS-wide blocking. Viewed project/source confirmation screenshots; JSON preserves 12 final accessibility observations, request IDs, raw files and screenshot hashes. Large captures/media are local under `test-output/native-save-dialog/`.

Three intermediate accessibility lookup failures were recorded, followed by fresh state reads and observed final controls. Original-protection error was already visible from an earlier attempt, so final retry did not prove a new alert transition; it proved actual source-name Replace and unchanged bytes. No product change. A later runner-only exit-recording fix marks interrupted sessions failed rather than running; syntax checked, not counted as another full run.

E04 native project/MP4 collisions and source protection passed these conditions. Browser download collisions/completion, power failure, other OS, all effect-source combinations, E06, human quality/time, and authenticated AI remain separate.

## Reproduction

This is interactive and waits for actual OS actions plus line-delimited JSON commands. Use only the READY-reported `files` directory and a fresh output directory.

```sh
npm run test:save:native -- --output=test-output/native-save-dialog-new
```

| JSON command | Action/check |
| --- | --- |
| `begin-project` | Choose existing.hypercut.json → Save → Cancel replacement → Cancel save |
| `check-project-cancelled` | Verify preservation |
| `begin-project` | Same file → Save → Replace |
| `check-project-replaced` | Verify current project |
| `prepare-export` | Render actual MP4 and preserve reference bytes |
| `begin-export` | existing.mp4 → Save → Cancel replacement → Cancel save |
| `check-export-cancelled` | Verify preservation |
| `begin-export` | Same MP4 → Save → Replace |
| `check-export-replaced` | Verify bytes/duration/full decode |
| `begin-export` | Generated source.mp4 → Save → Replace |
| `check-original-protected` | Verify rejection and source |
| `finish` | Check five results and unmodified save function; close app |

Example input: `{"command":"begin-project"}`. Preserve independent OS observations; controller file checks alone cannot prove which OS button was selected.

## Evidence and related records

- [2026-09-05-native-save-dialog-plan.md](../plans/2026-09-05-native-save-dialog-plan.md)
- [2026-09-05-native-save-dialog.json](results/2026-09-05-native-save-dialog.json)
