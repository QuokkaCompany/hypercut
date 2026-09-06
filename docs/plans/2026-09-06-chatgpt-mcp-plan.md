# Sending editing proposals from ChatGPT to HyperCut

2026-09-06. This plan predates the MCP server; local stdio and proposal reception in both apps were subsequently implemented. See [execution results](../testing/2026-09-06-mcp-results.md). Actual ChatGPT account, tunnel, and model execution remain unverified.

## Connection assumptions

The [connection guide](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) described public HTTPS or a tunnel for developer-mode connections. Account/workspace policy, execution credentials, tunnel ID, Platform organization permissions, and target workspace linkage require separate verification. Documentation does not establish this user's access or free use. Personal development and public plugin distribution also differ. No account settings, keys, tunnels, or model calls were accessed/created during this investigation.

Start with a local stdio adapter and limited app bridge, then verify actual account connectivity. Public HTTPS would additionally require hosting, per-user authentication, access controls, and operational checks. Existing manual request/JSON import remains available but is not direct ChatGPT tool use. Do not change product/package during active performance measurements.

## Scope and tools

The user chooses a task and its scope: silence settings, selected caption corrections, or selected effect placement, reusing existing limits. Freeze a snapshot with separate share ID, scoped credential, and expiry. Do not expose the editor's full API token or automatically attach media, filenames, source paths, or other projects.

`get_shared_edit_context` returns only allowed data for that share. No project enumeration, arbitrary file access, network proxy, or command tool is provided. `submit_edit_proposal` carries share ID/context version and passes existing validators before appearing in the comparison UI. Reception does not edit the timeline, render, or start paid inference. User-selected application uses existing undo/save, and external clients can distinguish receipt from application.

Changed target/settings/scope reject old proposals. Revocation, expiry, and shutdown reject new requests. Authentication material stays out of project JSON, shared results, and normal logs. Missing authorization is never allowed by default.

## Fixed limits and lifecycle

- At most eight concurrent shares. Creation/proposal/review JSON ≤128 KiB UTF-8; stdio buffer ≤132 KiB including protocol framing; app responses ≤384 KiB. Adapter permits four concurrent app requests, each with a five-second timeout.
- Maximum share lifetime 15 minutes. Only the app's share screen renews the 90-second lease; external reads cannot renew it. Active UI polls every 1.5 seconds. Each share has a new access key/configuration.
- One proposal per share. Identical ID/body replay returns the same result; changed ID/body is rejected. Changed app state requires a new share.
- Explicit revocation is complete only after server acknowledgment. On failure, stop renewals and offer retry. Close/target-change revocation can fail offline; expiry remains 90 seconds after the last app heartbeat.
- Apply synchronously in the app, then record the result. Failed acknowledgment must never reapply edits; settings UI supports retrying only the result delivery.
- After apply/reject, erase request/proposal bodies; retain a receipt only for the remaining lease. It records the historical event, not the current timeline after undo. Explicit revocation deletes the receipt too.
- Effect application changes its snapshot and closes the dialog before acknowledgment. A disconnect may preserve the edit while preventing the external client from confirming success; do not infer acknowledgment.

Use official TypeScript MCP SDK 2.0.0 stdio, testing local operation and older initialization compatibility separately from ChatGPT.

## Additional A-case checks

| Cases | Check | Required evidence |
| --- | --- | --- |
| A01/A06 | Disconnected, unshared, expired, revoked | Deny requests while local editing/save/export remain usable |
| A02/A07 | Initialize/list tools/read context/submit three task types | Actual protocol round trip and schema agreement; distinguish mock model from ChatGPT |
| A03 | Invalid schema/settings, unshared cues/assets, command strings | Reject without edits, file changes, or external calls |
| A04 | Adapter exit, transport loss, timeout, reconnect | Preserve work and show retryable errors |
| A05/A08 | Replay, old versions, project changes | No duplicate/stale application; compare projects after apply/undo |
| A06 | Serialized payloads/logs | Allowed text/numbers only; no credentials/media/filenames/other projects |
| A07 | Actual account/developer mode/tunnel/chat | Independently verify setup, auth, tool discovery, proposal, apply, and usage; unknown billing is not zero |

Advance to account testing after local protocol and both-app flows pass. Missing permissions leave the integration unverified. Manual JSON or direct API success cannot substitute for ChatGPT MCP success.
