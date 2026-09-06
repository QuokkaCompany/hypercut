# Claude Code integration verification — 2026-09-05

Experimental subscription-login settings proposals were added after `bb7c168`. Installed CLI/login checks and mock subprocess/API/browser/Mac tests passed. **Authenticated inference calls: zero. Actual model quality/usage: NOT_RUN.** This does not pass A07 or G4.

Environment: M4 Max/macOS arm64, Node 24.14.1, Electron 44.2.0, FFmpeg 8.1.1. Automation supplies generated file paths; no private recordings/account data used as fixtures.

Check installation, required flags, and subscription auth, rejecting API-key/other-provider auth for this path. Send only request and four settings, validate schema/ranges, and apply only after user review. Show returned model/token usage when available; unknown usage stays unknown, with no inferred bill/quota. Cancel/timeout/shutdown terminate CLI work while local editing/export remain available.

| Check | Result |
| --- | --- |
| Unit | 34 PASS, including four CLI contracts |
| Actual mock CLI process | 3 PASS: stdin/UTF-8/timeout/size/descendant cleanup |
| API | 11 PASS, including two CLI lifecycle cases |
| Package, CLI E2E, core E2E, recovery | PASS in specified browser/Mac paths |
| Actual installed CLI status only | Version 2.1.260, required flags and subscription login confirmed |

48 unique checks in this change. The previously passing 27 media/compatibility/failure/atomic/ENOSPC checks were not rerun after this AI change; 75 combined historical passes must retain that qualification. E2E is separate.

Mocks blocked logged-out requests, accepted logged-in proposals, and showed fixture token counts 123 input/45 output (not account usage). Browser/Mac cancellation observations were 58.32/49.14 ms, single values rather than p95. After cancel, actual FFmpeg analysis/export succeeded. The 390 px dialog remained usable. Screenshots showing `fixture-model`/mock login are not actual account evidence; the status JSON is the separate installation/login observation.

Shell characters remained stdin data, including fragmented Korean UTF-8. Reject >256 KiB output, invalid/incomplete JSON, and out-of-range settings without exposing raw provider errors/session/account identifiers. POSIX cancellation killed descendants ignoring SIGTERM; Windows tree cleanup was not executed. Saving configuration during a held login check recovered recheck/request controls by separating status and proposal staleness.

CLI uses a temporary cwd, stdin, `shell:false`, filtered API tokens/provider endpoints/NODE_OPTIONS, and preserved HOME for existing login. Safe mode, empty built-in tools/MCP, disabled session storage, and unattended permission denial were used. Administrator-enforced hooks are not claimed to be removed. Provider documentation was inspected on the execution date; current account policies/limits/billing require separate verification.

Actual authenticated Claude proposals/quality/quota, other real providers, direct ChatGPT MCP, human Korean Q01–Q05, and remaining MVP gates were outstanding. This does not establish VAD/STT/caption/effect or full MVP completion.

## Evidence and related records

- [2026-09-05-claude-cli-ui.json](results/2026-09-05-claude-cli-ui.json)
- [2026-09-05-claude-cli-recovery.json](results/2026-09-05-claude-cli-recovery.json)
- [2026-09-05-claude-cli-status.json](results/2026-09-05-claude-cli-status.json)
- [cli-reference](https://code.claude.com/docs/en/cli-reference)
- [15036540-use-the-claude-agent-sdk-with-your-claude-plan](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [README.md](README.md)
