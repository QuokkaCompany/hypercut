# Clips, TXT transcripts, and multilingual captions

2026-09-06, changes after `adf0624`. This feature record is not full MVP release acceptance.

Implemented ten selectable transcription languages (Korean, English, Japanese, Chinese, Spanish, French, German, Portuguese, Italian, Russian) plus automatic detection. Translation uses existing Ollama/OpenAI/Anthropic/Claude CLI/manual JSON/MCP paths, processing at most 20 cues/4,000 characters per batch with comparison, selected apply, and next-untranslated navigation. Preserve source text/timing and per-language translations; missing/stale translations block affected SRT/TXT/captioned MP4 until corrected. Output-language selection and translation edits support undo/redo, v8 persistence, and v1–v7 reading. Menus remain Korean.

Full/edited UTF-8 TXT includes all/retained sentences, with partial-cut review. Source-range or consecutive-sentence clips use current cuts/captions/effects at original resolution and report actual frame-expanded range/duration. Partial-caption clips require a wider range or captions disabled. Add verified regular/bold Noto Sans CJK KR fallback, loaded only for the selected weight when needed; check hashes/glyphs.

| Verification | Outcome and scope |
| --- | --- |
| Final units | 97 PASS: language/source snapshots, duplicate/missing/wrong source rejection, unchanged translation acceptance, staleness, TXT, v8/migrations |
| Media/API/effects/MCP | Initial 46 had two filename failures; fixed and related 13 API passed. Actual CFR/VFR/PTS clip markers/effect tails and mock-provider/real-stdio acknowledgments |
| Final rendering/correction API | 17 PASS after lazy fonts: 20 language/weight samples, boundaries/clipping/missing fonts/unsupported glyphs/cancel, actual Chinese MP4, correction API |
| Actual local transcription | Four PASS: English/Japanese/Chinese TTS and Japanese auto; real small-model inference, key text, valid timing, source hashes |
| Final Chrome/Mac | One complete flow each: missing/stale rejection, source preservation, translation edit/undo, exact TXT/SRT, five-second sentence clip, ≈1.266-second arbitrary clip, full decode, v8 reopen |
| MCP in both apps | Settings/correction/Japanese translation/effects selected apply and receipts, undo/revoke/acknowledgment retry; no external account/model |
| Correction UI regression | Both apps PASS: numeric/negation guards, selected apply, stale/cancel/retry, SRT/project/styled MP4 |

Browser downloads were reopened; native used actual save IPC/writes with test-selected destinations, not manual OS dialogs. Viewed source/translation UI, Chinese output frames, and 390 px layout. A UI race allowed saving an old clip while another rendered; add job-state guards to save control/handler, then verify sequential different-length clips in both final apps.

```sh
npm test
npm run test:multilingual
node --test tests/media.integration.mjs tests/api.integration.mjs tests/effects.integration.mjs tests/mcp.integration.mjs
node --test tests/caption-rendering.integration.mjs tests/caption-correction-api.integration.mjs
npm run test:multilingual:transcription
npm run package:desktop
npm run test:multilingual:e2e
node scripts/mcp-e2e.mjs --desktop
node scripts/caption-correction-e2e.mjs --desktop
```

Requires local Whisper/FFmpeg/relevant macOS TTS voices, Chrome, and new package. Mocks do not establish translation quality; no user paid model/private video used. Real authenticated translation/cost, human recordings per language, post-change long composition, clean-Mac install/signing/notarization remain unverified. Chinese TTS also misrecognized a phrase, so connection success is not accuracy. Earlier `93d616f` 24-run performance does not transfer to this changed build.

## Evidence and related records

- [2026-09-06-clips-multilingual-plan.md](../plans/2026-09-06-clips-multilingual-plan.md)
- [2026-09-06-multilingual.json](results/2026-09-06-multilingual.json)
- [manifest.json](../../assets/fonts/manifest.json)
- [OFL.txt](../../assets/fonts/OFL.txt)
