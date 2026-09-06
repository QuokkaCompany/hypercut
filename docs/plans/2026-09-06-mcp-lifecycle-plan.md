# MCP shares and delayed-response validation

2026-09-06. Exercise remaining A05/A08 races from the [MCP contract](2026-09-06-chatgpt-mcp-plan.md) in actual Chrome/Mac applications. This adds neither authenticated inference nor a new connection type.

| Case | Delayed response and action | Pass condition |
| --- | --- | --- |
| L01 | Hold share A creation; change request/create B | Revoke late A; preserve B ID/content/readiness |
| L02 | Hold creation; close AI; open another source/project; create new share | Revoke old share; preserve new source/settings/context |
| L03 | Hold status containing proposal; change request/create new share | Old proposal never appears/applies in new comparison |
| L04 | Hold pre-apply check; change request; hold new creation; release old check | Old completion/error cannot overwrite new loading/error/edit state |
| L05 | Hold creation; select another connection; release | Revoke old share; preserve connection; no MCP panel reappearance |
| L06 | Inject 503 into current pre-apply check; inspect error; finish review without applying | Show current error/retry, preserve settings, record actual rejection |

Perform real server create/read/revoke operations, holding only response delivery through Playwright. Do not count this as a repeat of stdio protocol tests. Record hold/release/delivery and finish creation delays within the app's five-second limit; timed-out creation's 90-second lease expiry remains separate. L06 injects 503 after a real status lookup to ensure stale-response fixes do not hide current failures.

Before running, compare browser bundle/relevant source and packaged file hashes. Use two synthetic sources with distinct projects; compare actual settings, new share context, revoked access, and complete final saved projects. Native paths are supplied by the runner, not manual OS-dialog evidence.

Preserve failures/source hashes and fix only affected transitions. Rerun all L cases and existing MCP flows in both apps, then freeze product/package before long performance testing. Do not change app code during those measurements.
