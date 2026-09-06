# Transcription readiness and actual recovery

2026-09-06. Distinguish engine/model absence, path type, access, model size, exact supported version, process failure, and timeout with reason codes and actionable UI guidance, without exposing raw stderr/internal paths. Recheck uses the existing caption control. Status does not initiate inference/download/AI and does not claim full integrity: SHA-256 remains checked before actual transcription.

Before the fix, unreadable models and lookalike versions `1.9.30 `/` 11.9.3` could report ready. Final implementation checks model readability and complete version syntax.

| Check | Final result |
| --- | --- |
| Files/process/API | 22 PASS: actual permissions, version, process failure, real 10 s timeout, pre/in-flight cancel, corrupt model before inference, authentication |
| Chrome recovery | Missing engine→missing model→ready→actual Whisper success |
| Packaged Mac recovery | Same flow using bundled engine/model |
| Edit preservation | Model-absent manual edit/save; repaired inference/undo/redo/save/reopen; full project match |
| Existing transcription | Four PASS: Korean TTS/channel/PTS/cancel/retry/same-size corruption/authenticated API/SRT |
| Build/package | PASS; nine relevant runtime/UI/bundle files match packaged contents |

Both actual transcriptions returned two cues with the expected Korean key phrase and in-source timing. Undo restored captions edited while the model was missing; redo restored inference. Compare all fields except saved timestamp. Original hash preserved, zero JS/observed external page errors.

Initial 18-case run: five PASS/13 FAIL. First fix passed 18 but rejected actual CLI prefix `whisper.cpp version: `. Preserve real output, add valid/invalid prefix cases, then 22 and real installed engine passed. First UI runner read an old native success notice and checked too early; actual file arrived later. Record failure recovery and clean only the stalled test app. Second UI attempt had async-response/assertion ordering issues; explicitly await new save and matching transcription completion and record failures before shutdown. Product unchanged between these UI reruns.

Recovery used links in test-owned directories to already prepared resources, not download or clean-machine setup. Native paths were test-supplied. OS network blocking, signing/notarization, human quality/time, and external AI remain separate. Prior `86a5c4d` warm 60 min three-run audit remains for that old package.

```sh
node --test tests/transcription-readiness.integration.mjs
npm run package:desktop
node scripts/transcription-readiness-e2e.mjs --desktop
```

Existing real transcription integrations used a separate output directory to preserve previous evidence. Mock readiness processes and real inference are separately recorded.

## Evidence and related records

- [2026-09-06-transcription-readiness-plan.md](../plans/2026-09-06-transcription-readiness-plan.md)
- [2026-09-06-transcription-readiness-verification.json](results/2026-09-06-transcription-readiness-verification.json)
- [2026-09-06-threshold-input-cache-results.md](2026-09-06-threshold-input-cache-results.md)
