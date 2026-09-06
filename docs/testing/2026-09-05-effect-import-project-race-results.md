# Preventing project replacement and mixed effects during import

Executed 2026-09-05 America/New_York. Reproduced on `6787a35` and verified corrected browser/Mac builds. A pending read of project B could finish while adding C to A despite disabled new-open controls. B became current, then A's stale effect list plus C was installed: saved data mixed B settings/cuts/captions/glossary with A+C effects. Reconnect similarly replaced A with B, without necessarily mixing lists.

Advance the shared operation sequence when effect import begins, invalidating earlier project reads. Keep current target through import and permit a later explicit B selection. `Effects.tsx` validation/add/cancel behavior stayed unchanged.

| Order | Before, Chrome/Mac | After |
| --- | --- | --- |
| B read held; start C; release B; complete C | FAIL/FAIL, mixed saved data | PASS/PASS |
| B held; complete C; release B | PASS/PASS | PASS/PASS |
| B held; reconnect A; release B; finish reconnect | FAIL/FAIL, changed target | PASS/PASS |
| B held; cancel C; select B again; release old responses | PASS/PASS | PASS/PASS |

Pre-fix: four FAIL/four PASS. Post-fix: **eight PASS**, same runner SHA-256. Compare complete v7 projects excluding save timestamp. Four successful-add conditions verified undo→A, redo→A+C, real preview with one effect, and subsequent complete B reopen/save. All source video/three asset hashes remained; zero page errors/observed external requests, not OS-wide network proof.

Regressions: 75 units, build/package, ordinary effects in both apps (two), project read/save races (eight), and core editing/manual-AI JSON in both apps (two): 12 UI regression runs, separate from eight new races. Package/source hashes matched.

Delay real `File.text()` returns rather than invoking disabled actions. Browser relays selected bytes to actual `/api/effects`, verifies returned fingerprint, then supplies the real result; Mac delays selection responses but uses real import IPC. Native dialog operation is not tested. Canceled-response `fulfill-resolved` is not evidence of consumed body; saved state independently confirmed C absent.

Harness v1 was incomplete after cleanup stalled and test processes were stopped. v2 browser `route.fetch()` payloads were invalid to ffprobe, excluding all four browser conditions from product judgment; Mac reproduced the defects but the run was not counted as complete. Explicit browser-server cleanup fixed four runner-owned leftovers; driver exited 1. Canonical v3 before/after used actual-byte relays and explicit cleanup, reaching saved comparisons without upload errors; exit 1 before/0 after. Ordinary effect regressions separately exercised unrelayed browser uploads.

```sh
node scripts/effect-import-project-race-e2e.mjs --output=test-output/FRESH_RUN_NAME
```

Requires current browser build, Mac package, Chrome, FFmpeg; generated video/three WAVs only, no authenticated LLM. This closes the previous named effect-import gap, not every file/project/OS race or all E06. Human quality/time, native network isolation, real AI, and final-candidate long performance remained separate.

## Evidence and related records

- [2026-09-05-effect-import-project-race-plan.md](../plans/2026-09-05-effect-import-project-race-plan.md)
- [2026-09-05-effect-import-project-races-before.json](results/2026-09-05-effect-import-project-races-before.json)
- [2026-09-05-effect-import-project-races-after.json](results/2026-09-05-effect-import-project-races-after.json)
- [2026-09-05-effect-import-project-races-regressions.json](results/2026-09-05-effect-import-project-races-regressions.json)
- [2026-09-05-effect-import-project-races-harness-v1.json](results/2026-09-05-effect-import-project-races-harness-v1.json)
- [2026-09-05-effect-import-project-races-harness-v2.json](results/2026-09-05-effect-import-project-races-harness-v2.json)
- [2026-09-05-editor-job-race-results.md](2026-09-05-editor-job-race-results.md)
