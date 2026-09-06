# AI caption correction implementation and validation

Implements the approved optional AI integration and C07/C08 through per-proposal selection, reusing caption undo history.

- Explicitly select the current cue or up to 20 consecutive cues/4,000 characters. Show the outgoing range/text and allow request-specific glossary terms.
- Share Ollama, OpenAI API, Anthropic API, and Claude Code connections. Manual chat copy/JSON import passes the same validation; it is not completed ChatGPT MCP integration.
- Assign a new request ID. Send IDs, text, terms, and correction instructions only; exclude paths, filenames, timing, media, and credentials.
- Accept only request ID and changes containing `id`, `before`, `after`, and `reason`. Reject wrong requests, unknown/duplicate cues, source mismatch, empty changes, timing/command fields, and numeric changes. Flag negation changes for review. These guards do not guarantee all semantic preservation.
- Start proposals unselected. Revalidate source and target immediately before applying selected changes once. Preserve timing and invalidate cut review for changed text. Reuse undo/redo, project, SRT, and MP4 paths.
- Changing provider/request/target, closing, or canceling invalidates old responses. No automatic application, retry, or fallback. Connection configuration and validated inference success remain distinct.
- [Project glossary persistence](2026-09-05-project-glossary-plan.md) supplies defaults; clearing or editing in the request dialog affects only that request.

Test fixed typos, numbers, negation, and glossary inputs first. Check each provider's request/error/cancel/stale-response contract and actual mock CLI processes. Exercise comparison, selected apply, cancel, undo, SRT, and MP4 in both apps using manual/mock connections. Real authenticated correction quality, cost, and Korean accuracy remain separate.

Contract sources: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Ollama](https://docs.ollama.com/capabilities/structured-outputs), [Anthropic](https://platform.claude.com/docs/en/build-with-claude/structured-outputs). Semantic validation remains application logic outside JSON schema.
