# Caption-screen selector overhead and lifecycle comparisons

2026-09-06. Diagnostics followed a second long-composition RSS failure at 2.140 GiB. They are not product-function or formal-performance passes.

Actual analysis of the same 60-minute source, 1,000 cuts/1,000 captions; fresh Chrome per role/CSS condition, three groups of 32 queries for the same active SRT button, no clicks/edits/exports. Product/build/input/project/runner hashes matched.

| Measure | Role | CSS |
| --- | --- | --- |
| Group median lookup ms | 37.853/35.791/34.983 | 4.710/4.482/4.276 |
| TaskDuration increase s | 3.580 | 0.345 |
| DevToolsCommandDuration s | 3.435 | 0.291 |
| Embedder heap MiB before→after | 38.371→177.720 | 38.070→38.589 |
| Server RSS MiB | 162.016→162.016 | 203.359→203.359 |
| App RSS peak GiB | 1.669 | 1.613 |
| Samples/observed seconds | 16/3.733 | 3/0.488 |

Same name/enabled/parent checked each query; 16,052 DOM nodes, 1,000 cuts/captions, and complete saved project preserved. No page/RSS errors or transient media/inference children. One run each, different starting RSS/durations and only three CSS samples prevent interpreting peak differences as long-memory savings or user-click response. Server heap read through test-parent private IPC, no HTTP endpoint/forced GC/cache purge/product changes.

## Formal runner comparison

Change remaining control lookups to scoped CSS with tag/role/exact-name/enabled checks, retaining 96 real actions/run, downloads/projects/media/criteria/all processes. Product/package unchanged; preserve runner/server copies and hashes.

Four 60-second runs passed exit 0 with identical 1,448 frames/16 captions/16 effects/six markers, projects and MP4/SRT bytes. Cancel actual caption preparation, preserve prior work, complete second output.

| App ×2 | RSS GiB | Max action p95 ms | Export seconds |
| --- | --- | --- | --- |
| Chrome | 1.689 | 100.994 | 3.714–3.728 |
| Mac | 1.127 | 60.132 | 3.705–3.784 |

Visible/ready cancel: Chrome 0.900/205.538 ms, Mac 0.700/206.671 ms; max sample interval 279.838 ms.

Long browser runner `5bb88a8` stopped after repetition 2 failed:

| Run | Analysis/export/oracle s | RSS GiB | Caption/effect/cut p95 ms | Verdict |
| --- | --- | --- | --- | --- |
| 1 | 36.792/194.064/124.318 | 1.976 | 149.457/196.637/66.438 | PASS for run |
| 2 | 37.089/194.593/125.328 | 2.146 | 187.957/193.545/66.445 | Memory FAIL |

Both 85,997 frames/1,000 captions/64 effects/six markers and complete projects/oracles passed. MP4 hash `3dd0d93f77ecfbe51fc1589e12906c978e82be06eff17dcfc7fc953dba85873a`, same as prior; max sample 279.512 ms. Cancel at caption-preparation 0.30015: 0.900/312.792 ms, preserve work and second output completes retry. Third/other long conditions NOT_RUN. Encoding-peak renderer 395.234→522.078 MiB/server 222.734→255.406 MiB; later decode validation was not peak. Lookup correction did not solve memory; do not subtract diagnostics from RSS.

## Video lifetime

Six open→seek second cue at source 4.4 s→close/reopen cycles per fresh Chrome condition, ordinary versus test-only pause/remove-src/load before actual close; no product changes.

| Measure | Ordinary | Explicit release |
| --- | --- | --- |
| Peak app RSS GiB | 1.737 | 1.746 |
| Renderer RSS MiB before→after | 648.188→816.469 | 648.922→772.328 |
| Embedder peak MiB | 107.754 | 108.245 |
| Samples/seconds | 24/5.801 | 25/5.932 |

Both preserve reopened 1,000 VTT cues/first text, 4.4 s seeks/3600 s source, and complete project. DOM16, 052 open/11,950 closed. Final RSS differences do not prove leak/savings; insufficient peak benefit to apply explicit release. Proceed with separately planned encoder/resource investigation.

## Evidence and related records

- [2026-09-06-caption-selector-role.json](results/2026-09-06-caption-selector-role.json)
- [2026-09-06-caption-selector-role-resources.json](results/2026-09-06-caption-selector-role-resources.json)
- [2026-09-06-caption-selector-css.json](results/2026-09-06-caption-selector-css.json)
- [2026-09-06-caption-selector-css-resources.json](results/2026-09-06-caption-selector-css-resources.json)
- [2026-09-06-caption-selector-comparison-audit.json](results/2026-09-06-caption-selector-comparison-audit.json)
- [2026-09-06-composition-memory-plan.md](../plans/2026-09-06-composition-memory-plan.md)
- [2026-09-06-composition-scoped-smoke.json](results/2026-09-06-composition-scoped-smoke.json)
- [2026-09-06-composition-scoped-smoke-audit.json](results/2026-09-06-composition-scoped-smoke-audit.json)
- [2026-09-06-composition-scoped-long.json](results/2026-09-06-composition-scoped-long.json)
- [2026-09-06-composition-scoped-long-audit.json](results/2026-09-06-composition-scoped-long-audit.json)
- [2026-09-06-composition-scoped-long-second-verification.json](results/2026-09-06-composition-scoped-long-second-verification.json)
- [2026-09-06-caption-lifecycle-normal.json](results/2026-09-06-caption-lifecycle-normal.json)
- [2026-09-06-caption-lifecycle-normal-resources.json](results/2026-09-06-caption-lifecycle-normal-resources.json)
- [2026-09-06-caption-lifecycle-release.json](results/2026-09-06-caption-lifecycle-release.json)
- [2026-09-06-caption-lifecycle-release-resources.json](results/2026-09-06-caption-lifecycle-release-resources.json)
- [2026-09-06-caption-lifecycle-comparison-audit.json](results/2026-09-06-caption-lifecycle-comparison-audit.json)
