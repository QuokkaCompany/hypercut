# Automation selector overhead and historical performance

2026-09-06. Following the editor candidate's 2.145 GiB memory failure, this experiment changed only the benchmark locator. Product code remained `a06c2b0`.

## Controlled interaction diagnostic

Each condition executed 288 real click actions against the same app, runner, build, and media, without forced garbage collection or heap snapshots.

| Locator | Peak app RSS (GiB) | Final renderer RSS (MiB) | Task duration (s) | Interaction elapsed (s) |
| --- | --- | --- | --- | --- |
| CSS | 1.528 | 396.47 | 3.824 | 25.842 |
| Role | 1.679 | 541.23 | 28.135 | 45.458 |

Both retained 11,962 DOM nodes and 1,000 rows with no errors or source changes. The earlier role-based diagnostic ended at 543.47 MiB renderer RSS. Installed Playwright source and hashes confirmed that role queries perform accessibility-related work. This is evidence about this diagnostic, not a general memory saving or proof of a product leak.

The threshold runner gained optional `--ui-locator=css`; role lookup remains the default. CSS selection still checks the actual accessible label, element type/name, and enabled state. Actions, output oracles, and limits stayed unchanged. Two short checks across both apps passed separately from the long matrix.

## Historical long matrix

Browser 60-minute repetitions had analysis times of 37.023 / 37.193 / 37.451 seconds, export times of 142.172 / 141.479 / 141.347 seconds, and RSS peaks of 1.845 / 1.929 / 1.980 GiB. Earlier role runs reached 1.860 / 1.924 / 2.145 GiB. Full analyses, projects, and MP4 bytes matched that earlier candidate. The 18 markers passed with maximum additional A/V error of 0.067 ms. Highest action p95 was 68.234 ms. Early PCM cancellation became visible in 1.1 ms, readiness took 318.117 ms, and the next run completed. The maximum sample interval was 279.029 ms; the narrowest RSS margin was 20.44 MiB.

| Surface / duration | Analysis median / max (s) | Export median / max (s) | Peak RSS (GiB) | Highest action p95 (ms) |
| --- | --- | --- | --- | --- |
| Chrome / 10 min | 6.529 / 6.712 | 24.065 / 24.084 | 1.733 | 67.319 |
| Mac / 10 min | 6.310 / 6.450 | 24.044 / 24.050 | 1.160 | 41.046 |
| Mac / 60 min | 36.457 / 36.503 | 142.146 / 142.707 | 1.319 | 50.548 |

The 10-minute cancellations occurred during preparation; no 10-minute role comparison was run. Mac 60-minute cancellation occurred during early PCM processing, with 1.0 ms feedback and 308.297 ms readiness. Across all 12 runs and four cancellation/retry conditions, 1,152 interactions passed, output hashes matched, and the maximum RSS sample interval was 280.129 ms.

## Later correctness finding

A subsequent independent full-frame oracle found retained boundary frames. These 12 runs passed the earlier runner's performance and sync checks, but byte equality did not prove correct cutting. They must **not** be reused as performance or correctness evidence for the later integer-PTS fix. Earlier role-based failures remain valid historical records. Human quality, OS-wide/cache conditions, and authenticated AI also remain separate.

## Evidence and related records

- [2026-09-06-editor-render-memory-results.md](2026-09-06-editor-render-memory-results.md)
- [2026-09-06-editor-render-memory-plan.md](../plans/2026-09-06-editor-render-memory-plan.md)
- [2026-09-06-selector-diagnostic-css.json](results/2026-09-06-selector-diagnostic-css.json)
- [2026-09-06-selector-diagnostic-role.json](results/2026-09-06-selector-diagnostic-role.json)
- [2026-09-06-selector-diagnostic-comparison.json](results/2026-09-06-selector-diagnostic-comparison.json)
- [2026-09-06-selector-source.json](results/2026-09-06-selector-source.json)
- [2026-09-06-selector-smoke.json](results/2026-09-06-selector-smoke.json)
- [2026-09-06-selector-browser-long.json](results/2026-09-06-selector-browser-long.json)
- [2026-09-06-selector-browser-long-audit.json](results/2026-09-06-selector-browser-long-audit.json)
- [2026-09-06-selector-ten-minute.json](results/2026-09-06-selector-ten-minute.json)
- [2026-09-06-selector-nine-run-audit.json](results/2026-09-06-selector-nine-run-audit.json)
- [2026-09-06-selector-mac-long.json](results/2026-09-06-selector-mac-long.json)
- [2026-09-06-selector-twelve-run-audit.json](results/2026-09-06-selector-twelve-run-audit.json)
- [2026-09-06-composition-oracle-results.md](2026-09-06-composition-oracle-results.md)
- [2026-09-06-long-composition-plan.md](../plans/2026-09-06-long-composition-plan.md)
