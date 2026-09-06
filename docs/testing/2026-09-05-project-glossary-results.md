# Project correction glossary results

Executed 2026-09-05 after `1ab12be`, no authenticated model calls. Later v7 end review is separate.

Project-specific terms ≤2,000 characters apply as one caption/style undo step and mark dirty without changing text/timing/cuts/output. Protect unapplied text/terms on close/selection/undo, browser refresh, and Mac close. Reselecting the same cue after approving discard now resets the actual input.

Project v6 adds `glossary`; v1–v5 migrate to empty. Reject missing/wrong-type/overlong/control-character values, allowing newline/tab/empty. Existing files change only on explicit save; older apps may reject v6. Correction defaults to project terms, permits temporary override/clear/reset without writing back, and invalidates prepared requests on changes. Save/copy/configuration does not call models; explicit correction sends selected text and visible terms only. New media/project clears old terms/history.

Checks: 69 units (four new), correction 11 (seven overlap/four API), AI effects 12 (eight overlap/four API), build/package PASS: **77 unique** automated checks. Full older media suites were not rerun in this count.

Both apps passed apply/undo/redo, keep/discard input, protected unapplied terms on otherwise saved projects, request overrides/clear/reset, stale rejection, save/reopen, corrupt-project rejection preserving work, and new-media reset. Captions/times/cuts/styles/effects stayed equal. Zero model requests during prepare/save; one explicitly initiated request was intercepted locally to inspect payload, not inference/usage. Zero page/external request errors; 390 px no horizontal overflow; Chrome/Mac/mobile captures viewed.

The first Mac close test double-handled a native confirmation via Playwright CDP and failed `No dialog is showing`. Stop extra CDP responses during native observation; final check observed invoked confirmation, kept window/input, and no remaining temporary app process.

Four flows × both apps = **eight UI PASS**: glossary, correction/SRT/styled MP4, effects/reconnect/v6/MP4, AI effects selection/context/cancel/decoded audio. Effect expected `[3,3.7)` yielded RMS 0.0631418669, peak 0.0925151110, silence peak zero in both apps; AI-effect preserved/applied RMS also matched. Record actual `projectVersion` rather than an obsolete fixed field name. Updating expected v6 in VAD/transcription runners is not a new inference run.

Real glossary adherence/Korean quality, engine/global dictionaries, automatic replacements, actual provider correction/placement, human speech/time, long performance, OS recovery, and direct ChatGPT remained outstanding then. Package unsigned/unnotarized and uses external FFmpeg/ffprobe. Local logs/captures: `test-output/glossary-*`.

## Evidence and related records

- [2026-09-05-transcription-end-results.md](2026-09-05-transcription-end-results.md)
- [2026-09-05-project-glossary-plan.md](../plans/2026-09-05-project-glossary-plan.md)
- [2026-09-05-project-glossary-ui.json](results/2026-09-05-project-glossary-ui.json)
- [2026-09-05-project-glossary-regressions.json](results/2026-09-05-project-glossary-regressions.json)
