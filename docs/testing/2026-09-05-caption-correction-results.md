# AI caption correction results

Executed 2026-09-05 on changes after `a8a5a6f`. This establishes selected-proposal handling, not authenticated Korean correction accuracy. Later project glossary/v6 persistence is separately recorded.

Requests contain up to 20 cues/4,000 characters, explicit terms/instructions and request/cue IDs, excluding media, filenames, paths, and cue timing. Existing Ollama/OpenAI/Anthropic/Claude Code/manual JSON share validators. Accept only `requestId`/`changes` with `id`, `before`, `after`, `reason`; validate source/target/duplicates/types/length. Reject numeric changes and timing/command extras. Mark recognized Korean/English negation changes for explicit semantic review, without claiming a complete meaning detector.

Unselected proposals require comparison and selected application as one edit. Revalidate snapshots immediately before apply; preserve timing/unselected text, invalidate changed cue cut-review, and reuse undo/redo/v4/SRT/styled MP4. One active settings/correction request, no retry/fallback. UUID cancellation targets only its request; server remembers the latest 1,000 started/canceled IDs in process memory to reject pre-canceled/duplicate requests. Disconnect/shutdown cancel work; client aborts and discards stale responses.

| Check | Outcome |
| --- | --- |
| Unit | 53 PASS, including seven new correction checks |
| Correction | 11 PASS: seven overlapping units + four API/mock-process |
| API | 12 PASS |
| CLI subprocess | 3 PASS |
| Build/package | PASS; Node 24.14.1/Electron 44.2.0/macOS arm64 |
| Correction and existing CLI E2E | Browser and Mac PASS |

72 unique unit/API/process checks; E2E/build separate. Selected a fixed Korean typo correction while preserving the number 10; an opposite-negation proposal stayed unselected and `10→100` was rejected. With source cut `[3,5)`, second cue `[7,8.5)` became SRT `[5,6.5)`. Both apps saved identical SRT, preserved source timing in projects, fully decoded styled MP4, and displayed reviewed correction frames. Zero UI errors and observed external requests.

The 390 px UI remained operable by scrolling. Runner fixes opened collapsed sections and improved the AI selector's accessible name; cancellation assertions checked explicit canceled status rather than generic errors. Mock CLI cancellation UI values were about 62 ms browser/51 ms Mac, not real service latency.

HTTP responses were mocked; temporary CLI executables were actual subprocesses, not authenticated models. UI used manual JSON/interception and fixed captions with synthetic media, not new transcription. Actual provider work/cost/Korean quality remained NOT_RUN. Request-only glossary was initially transient. Regex/negation guards do not guarantee names, units, facts, or complete semantics. Human evaluation, direct ChatGPT, effects, long performance and remaining product gates were outstanding then.

Local logs: `test-output/correction-{unit,integration,api-regression,cli-regression,build,package,e2e,cli-e2e-regression}.log`; UI/mobile/export PNGs under the same prefix. Structured schema conformance and semantic correctness remain separate.

## Evidence and related records

- [2026-09-05-project-glossary-results.md](2026-09-05-project-glossary-results.md)
- [2026-09-05-caption-correction-plan.md](../plans/2026-09-05-caption-correction-plan.md)
- [2026-09-05-caption-correction-ui.json](results/2026-09-05-caption-correction-ui.json)
- [2026-09-05-correction-cli-regression.json](results/2026-09-05-correction-cli-regression.json)
- [structured-outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [structured-outputs](https://docs.ollama.com/capabilities/structured-outputs)
- [structured-outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
