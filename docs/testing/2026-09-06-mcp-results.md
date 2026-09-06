# Local MCP protocol and editing proposals

2026-09-06. Local protocol and app proposal reception were implemented and tested. Actual ChatGPT accounts, tunnels, models, and human editing quality were not validated.

Experimental MCP shares selected settings, captions, or effects using a one-time scoped key separate from the editor API token. One stdio adapter binds to one share. Its only tools are `get_shared_edit_context` and `submit_edit_proposal`; it provides no arbitrary file, media, project-listing, or shell access. Existing domain validators enforce user comparison and selected application, rejecting wrong authority, stale snapshots, and invalid/duplicate changes. Only selected text and numbers are shared.

The maximum lifetime is 15 minutes, with a 90-second lease renewable only by the app. After apply/reject, request and proposal bodies are discarded; only a receipt remains until lease expiry. New work, expired shares, or revoked shares require new settings. A receipt records actual app application, not a model's claim or current state after undo.

## Executed checks

Nineteen contract/transport checks passed without skips:

- Eight share-store checks cover copying, privacy, authentication, scope, numbers, replay, staleness, results, virtual-clock expiry, size/count limits, and shutdown.
- Seven actual HTTP/SDK checks cover separate authorities, Origin, size, JSON, three actual stdio tasks, schemas, restart, replay, and receipts.
- Four transport checks cover 2025-06-18 initialization, EOF, SIGTERM, oversize input, a five-second local HTTP timeout, and socket closure.

Each app completed three task flows with actual official SDK child processes. Mac used the supplied executable and `ELECTRON_RUN_AS_NODE` to run the packaged adapter. Checks covered changes/revocation, explicit revoke failure/retry, selected application/undo, acknowledgment retry without duplicate edits, complete project round trips, and actual MP4 decoding with independent RMS measurements. No API keys or external models were used. Regression groups passed 88 unit, 12 API, 11 correction, and 12 AI-effects checks, with overlaps between groups; existing manual/mock correction and effects E2E flows passed in both apps.

An eight-second fixture retained cut `[2, 4)` and changed one caption/effect. Source time 5 seconds mapped to output 3 seconds. RMS at 3.1–3.3 seconds was approximately 0.07080272 in both apps; the unselected addition at 4.1–4.3 seconds had RMS zero. Complete projects matched except timestamps. Comparison UI was viewed at 390 px and on Mac, without claiming full accessibility, screen-reader, or device coverage. Native paths were supplied by the runner.

Three initial UI failures involved label lookup, undo/input update timing, and missing fixture `reason: silence`. They were preserved and the harness corrected without product changes. Later review found premature revoke-success reporting. The app now waits for server acknowledgment; failure explains uncertainty, stops renewals, and offers retry. Both-app 503 tests proved the share remained readable before retry and was denied afterward. The initial completed record remains separate.

## Limits

Real-account discovery, model usage, tunnel authentication, wall-clock 15-minute expiry, and all client versions remain unverified. Settings-receipt retry is covered. The effects dialog closes after application, so a disconnect can leave applied edits without an external acknowledgment; success must not be inferred. Later lifecycle tests cover 12 named creation/project race conditions. MCP changes invalidate reuse of old `b60b115` performance as current evidence.

```sh
npm run test:mcp
node --test tests/mcp-transport.integration.mjs
npm run package:desktop
node scripts/mcp-e2e.mjs --desktop
```

UI runners create fresh timestamped output folders and use synthetic data only. Explicit output directories must also be new.

## Evidence and related records

- [2026-09-06-chatgpt-mcp-plan.md](../plans/2026-09-06-chatgpt-mcp-plan.md)
- [2026-09-06-mcp-verification.json](results/2026-09-06-mcp-verification.json)
- [2026-09-06-mcp-initial-verification.json](results/2026-09-06-mcp-initial-verification.json)
- [2026-09-06-mcp-lifecycle-results.md](2026-09-06-mcp-lifecycle-results.md)
- [stdio.md](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)
- [secure-mcp-tunnels](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
