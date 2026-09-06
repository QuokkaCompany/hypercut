# Late MCP application checks and new-request preservation

2026-09-06. Reproduced on `e3c5ab5` under L01–L06. While a pre-apply status read waited, changing instructions and starting a new share could let the old read's error clear/show state in the new screen. Application itself was blocked, but error handling checked only whether the component remained mounted.

Show an apply-check error only when the same share object and request context remain current. Preserve existing apply guards and current-error/retry behavior. First runner failed by reading a project before new media finished importing; second passed L01–L03 then reproduced L04 stale error. Keep those failures distinct.

Final browser/Mac six cases each: **12 PASS**, including delayed creation/status/apply checks, media/project/provider changes, and current 503/review-completion retry. Twelve held responses were delivered; maximum creation hold 232.47 ms, within five seconds. Distinct sources and−40/−52 dB settings remained; final full project matched B except save timestamp. Eleven relevant source/media/timeline/HTML/JS/CSS files matched the native package.

Existing MCP settings/caption/effects flows in both apps: six PASS using actual stdio children, revoke failure/retry, duplicate proposals, partial apply/undo, and acknowledgment retry without repeated edits. Saved/reopened projects and actual MP4 full decode/effect timing/gain passed. Both MP4 SHA-256 `3058c3dd820040ae9b44a1295a340cd17a793871b1c2950ca5d12efc917dda03`; applied effect RMS≈0.07080272, unselected addition RMS 0. Zero JS errors/observed external requests/separate provider calls, not OS network-block proof.

Synthetic media/local clients only; real ChatGPT/Claude accounts, tunnels, model quality unverified. Native destinations supplied by runner. Human speech/time, clean-Mac install, signing/notarization, and new-candidate long performance remain separate; changed UI/package requires fresh performance identity.

```sh
npm run package:desktop
node scripts/mcp-lifecycle-e2e.mjs --desktop
node scripts/mcp-e2e.mjs --desktop
```

Use fresh result directories; lifecycle runner preserves its executed source and old failures.

## Evidence and related records

- [2026-09-06-mcp-lifecycle-plan.md](../plans/2026-09-06-mcp-lifecycle-plan.md)
- [2026-09-06-mcp-lifecycle-verification.json](results/2026-09-06-mcp-lifecycle-verification.json)
