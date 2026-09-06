# AI sound-effect proposal results

Executed 2026-09-05 on changes after `6c8026b`. Implements the AI effects contract; zero authenticated model calls. Versions/counts describe this historical run. Later glossary/v6 work is separate.

## Implemented behavior

Users explicitly select up to eight assets, 32 editable/deletable clips, and optionally 20 captions/4,000 characters (selection pages of 20). Send aliases, descriptions, duration, source placement/asset offset/length/gain/mute, selected caption text/timing, video length, and at most 2,000 kept intervals. Reject excessive scope rather than truncating it; exclude filenames, paths, hashes, and media. Models cannot hear assets and rely on descriptions.

Existing Ollama/OpenAI/Anthropic/Claude Code/manual JSON paths share validation. Accept at most 20 add/update/delete proposals, checking request ID, selected targets, before values, numeric ranges, exact fields, and duplicates. Invalid entries reject the complete response. New IDs derive from request UUID/reserved aliases. Comparison shows source and estimated edited timing, audible duration, gain/mute/deletion, including removed starts and end truncation; encoded preview establishes final frame-aligned behavior.

All proposals start unselected. Selected changes form one undo step; unselected deletions/out-of-scope clips survive. Revalidate local media/track/cut/effect/caption identity immediately before apply, including different sources with identical values. A changed background edit closes/cancels stale AI state and resets selections. Reuse project v5 and actual rendering. One active AI request, pre-cancel/deduplication/old-cancel isolation/disconnect protection remain; no retry/fallback.

## Checks and actual output

| Command | Passes |
| --- | ---: |
| `npm test` | 65 |
| `npm run test:ai-effects` | 12 (eight domain/provider + four API/mock CLI) |
| `npm run test:correction` | 11 |
| `npm run test:api` | 12 |
| `npm run test:effects` | 13 |
| `npm run test:media` | 8 |
| `npm run test:captions` | 15 |

108 unique unit/API/media checks; UI/build/package counted separately. Node 24.14.1, Electron 44.2.0, macOS arm64. Actual mock CLI subprocesses verified model/schema/stdin/no tools/no MCP/no session persistence/usage display, not user authentication.

Both browser and package passed new AI-effects UI/output plus correction, manual-effects, and Claude-settings regressions. Fixture: eight-second H.264, original 1 kHz/800 Hz beeps, cut `[2,4)`, two captions/assets, three existing clips. Select only first asset, first two clips, first caption. Reject 99-second placement and an unselected asset. Apply first-clip update plus addition, leave second-clip deletion unselected: undo restores three clips; redo gives four. Stale/background-change/cancel-retry checks preserved state; intercepted cancellation does not establish actual model cancellation.

| Output | Expected edited interval | RMS, identical in both apps |
| --- | --- | ---: |
| Updated first clip, −6 dB | `[3,3.4)` | 0.070802721 |
| Unselected deletion, −12 dB | `[4,4.5)` | 0.035504467 |
| Added clip, −12 dB | `[4.5,4.75)` | 0.035499683 |
| Unselected other asset, −12 dB | `[5,5.5)` | 0.035494882 |
| Checked silence | `[2,2.8)` | 0 |

Interior decoded PCM, domain timing expectations, and existing effect boundary tests supported these results. Full decode and viewed Korean frames passed; zero page errors/observed external browser requests. No new OS network-block test. The initial PCM checker used fractional `4.1 × 48000` as a byte index; rounding sample indices fixed the runner without changing product timing/criteria.

## Limits

FX04 contracts passed these conditions, not real model placement or perceptual sound quality. Human Korean quality, clipped syllables, editing-time savings, listening, long VAD/STT/composition, remaining OS/save conditions, authenticated AI and direct ChatGPT integration were outstanding at this record. Local artifacts: `test-output/ai-effects-*.log`, `ai-effects-{browser,desktop}.mp4`, UI/mobile/export PNGs. Large generated media is excluded from Git.

## Evidence and related records

- [2026-09-05-project-glossary-results.md](2026-09-05-project-glossary-results.md)
- [2026-09-05-ai-effects-plan.md](../plans/2026-09-05-ai-effects-plan.md)
- [2026-09-05-ai-effects-ui.json](results/2026-09-05-ai-effects-ui.json)
- [2026-09-05-ai-effects-ui-regressions.json](results/2026-09-05-ai-effects-ui-regressions.json)
