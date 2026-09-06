# Recovery, partial restoration, and app performance — 2026-09-05

Strengthened browser/native preview recovery, not full MVP validation. Human Korean listening/labels/time and actual AI were not executed. Earlier preview measurements retain their original scope; later range-preview evidence is separate.

Client-generated job IDs enable cancellation before POST delivery; server records pre-cancel and acknowledges after child cleanup. Late results preserve edits. Partial restore expands outward to frames and restores leftover deletion fragments <100 ms. All-removed output explains its block. Added R restore/toggle, Cmd/Ctrl+Z on buttons, timeline zoom/scroll/density, atomic temporary-write/fsync/replace, and valid one-frame output even below 50 ms.

Checks: 28 units, six media, eight API, eight failure/atomic, one actual ENOSPC, plus ten retained earlier compatibility = **61 historical PASS**. Build/package, core both-app E2E, browser recovery/partial restore/offline, desktop long benchmark and browser stress separate. Native paths were test-supplied.

## Actual failure/recovery evidence

A temporary 32 MiB HFS+ sparse image was filled to produce actual ENOSPC during project replacement/media export. Preserve previous project/source hashes, clean partial output, free test files and retry; detach/delete only the test image. Test-owned permission removal produced EACCES/EPERM/read denial. SIGKILL actual FFmpeg mid-output preserved source/cleanup/retry. A separate process using product atomic save was killed before rename; this was not yet whole-Electron or power-loss testing.

Hold analysis POST before server, cancel: UI finished in about 53.19 ms, restored edits remained. Finish newer settings analysis then release old POST; no overwrite. Corrupt-project load preserved edits. Held mocked OpenAI responses after dialog close/settings changes were discarded; mocked 503 still allowed actual local analysis/export, with no auth/billing.

A four-second all-silent MP4 restored requested `[1.01,1.99)` outward to `[1,2)`, producing one-second preview/MP4 with full decode. Undo/redo/R/reversed-range rejection/full restore passed.

## Performance, with artifact limits

M4 Max/Mac16,9, 14 CPUs/36 GiB, Darwin25.5 arm64/local SSD, Node24.14.1/Electron44.2.0/FFmpeg8.1.1; AC/low-power off, other apps not closed, OS caches unpurged. Simple synthetic 1080p30 H.264/AAC48k, three runs each. Native selection→all inspection/hash/UI/waveform/cuts; export includes full decode/save readiness, excludes final user-path copy.

| Input | Analysis median/max s | Export median/max s | Full native RSS GiB | Cuts |
| --- | --- | --- | --- | --- |
| 10 min | 5.93/6.17 | 16.18/16.22 | 1.362 | 166 |
| 60 min | 35.24/35.34 | 95.31/96.40 | 1.651 | 1,000 |

Sample whole Electron descendant RSS at 250 ms, excluding driver; inter-sample peaks unknown. First cache unknown, later reused. No concurrent media tests; small edits/builds occurred. Partial-restore/zoom UI changed afterward, so this is not final-UI whole-app RSS.

Browser 1,000-cut actions: 32 restore/undo +16 settings +16 play/pause =64, p95 150.35 ms including locator/two-frame overhead. Analysis/preview/export visible cancel: 20.0/21.9/29.9 ms; finished state: 224.6/313.3/321.6 ms. Cuts/retry readiness preserved. Overlapping cut hitboxes at 1× motivated zoom; verified cut401 at32×. Later tick-density/waveform memoization passed short E2E with five distinct ticks/selected-cut scrolling, but stress values were not rerun after that final change.

## Case updates and limits

Specified conditions PASS: D12/U03 (one-frame/all-silent/restore), D15 (cancel/new settings/stale request), U02, E01/E02/E05, and mock A01. Follow-up records separately establish native E03 kill/reopen, native E04 actual prompts, and named E06 I/O/job/editor races; they do not cover every E06 path. U01 remains partial: browser OS-blocked flow passed, Electron nested sandbox failed initialization. Preserve sandbox/contextIsolation/no nodeIntegration; do not disable security to pass.

P01/P02 remain partial for cold-cache/final UI; A05 has only named stale cases; M06/Q01–Q05 await human data/listening/time; A02/A06–A08 await actual integrations/remaining tools. No unrelated private files were searched. G1 technical scope passed, G2 partial, G3/G4 actual acceptance pending.

## Evidence and related records

- [2026-09-05-range-preview-results.md](2026-09-05-range-preview-results.md)
- [2026-09-05-preview-results.md](2026-09-05-preview-results.md)
- [2026-09-05-recovery.json](results/2026-09-05-recovery.json)
- [2026-09-05-restore.json](results/2026-09-05-restore.json)
- [2026-09-05-offline.json](results/2026-09-05-offline.json)
- [2026-09-05-desktop-performance.json](results/2026-09-05-desktop-performance.json)
- [2026-09-05-ui-stress-expanded.json](results/2026-09-05-ui-stress-expanded.json)
- [2026-09-05-desktop-save-crash-results.md](2026-09-05-desktop-save-crash-results.md)
- [2026-09-05-native-save-dialog-results.md](2026-09-05-native-save-dialog-results.md)
- [2026-09-05-project-io-race-results.md](2026-09-05-project-io-race-results.md)
- [2026-09-05-job-cancellation-race-results.md](2026-09-05-job-cancellation-race-results.md)
- [2026-09-05-editor-job-race-results.md](2026-09-05-editor-job-race-results.md)
