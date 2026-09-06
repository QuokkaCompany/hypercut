# Caption design and actual MP4 rendering results

Executed 2026-09-05 after `b2c977c`; later AI correction is separate. Both apps support plain/box/emphasis styles, size/position/margins, caption inclusion, encoded full/range previews, and v4 undo/save. v1–v3 preserve old edits and migrate to captions disabled with default style. Changes invalidate previous outputs; unresolved partially cut cues block captioned rendering. Source playback uses ordinary VTT, whereas style samples/encoded previews use the renderer. SRT stores wording/timing only.

Environment: M4 Max/macOS arm64, Node 24.14.1, Electron 44.2.0, FFmpeg 8.1.1. Canvas 1.0.8 renders plain text to transparent PNG using bundled Noto Sans KR Regular/Bold, OFL 1.1, revision `f8d157532fbfaeda587e826d4cd5b21a49186f7c`. Child processes verify hashes/glyphs, disable system-font loading, and reject missing/corrupt/unsupported data without silent fallback. Word-first wrapping uses at most three lines, splitting an oversized word only when necessary, shrinking with visible actual size or rejecting text that cannot fit.

Round absolute transition times to microseconds before differences, concatenate PNG input and overlay with existing FFmpeg; no libass/global replacement. Lay out at orientation/SAR-correct display size, downscaling only previews. Cancel waits for child cleanup and deletes task directories, including server shutdown. Native canvas is unpacked from ASAR and fonts load from the package (about 937 MiB then); external FFmpeg remains required. Signing/notarization/other OS were unverified.

| Check | Result |
| --- | --- |
| Unit | 46 PASS |
| API | 12 PASS |
| Media | 8 PASS |
| Caption rendering integration | 6 PASS |
| Build/package, caption E2E, silence E2E | PASS in both apps |
| OS-blocked external network | Browser PASS with real VAD/Whisper/style/SRT/MP4; external probe EPERM |

72 unique unit/API/media/rendering checks; E2E/build/offline separate. A wrap fix was followed by affected rendering/package/caption/offline reruns, without adding old transcription/performance counts.

## Independent frames and app evidence

640×360, 30 fps, six-second source, cut `[2.5,3.5)`, captions `[1,2.3)` and `[4.001,5)` yielded five seconds/150 decoded frames with captions `[1,2.3)` and `[3.001,4)`. Check every frame's white/yellow pixels/PTS including absence intervals for all three styles; source hashes unchanged.

Portrait, 90-degree rotation, and SAR 2:1 produced 360×640, 360×640, and 1280×360 displays, with glyph pixels inside 4% edge margins and selected top/bottom placement. Mixed 15/30 fps VFR and +5 s input PTS used actual timestamps without duplicate frames. Source preview `[2.1,5.1)` yielded two seconds with caption ranges `[0,0.2)`, `[0.901,1.9)`, without double subtraction.

Viewed PNG/MP4 frames covered Korean/English/numbers/newlines, literal markup-like text, and long portrait captions. Visual inspection found split English words and led to word-first wrapping. Fixture rotation/SAR generation and oracle VFR duplication were corrected without relaxing timing/safe-area/source criteria. Missing fonts, unsupported emoji, and excessive text failed explicitly. Canceling actual 1,000-caption preparation cleaned up within five seconds and retried without partial files; this is not full 1,000-caption performance evidence.

Both apps actually transcribed Korean TTS, manually corrected text/times, saved identical SRT, and showed 3,326 yellow caption pixels in composed preview. Saved MP4 fully decoded and frames were viewed. Style changes invalidated outputs; undo/redo/v4 reopen restored values. Zero UI errors/observed external requests. The 390 px layout had no horizontal overflow. Electron retained sandbox/context isolation, no node integration. Native path responses were substituted; Mac OS network isolation remained blocked by nested sandbox constraints.

## Outstanding scope

Human CER/timing/time savings, long caption time/union memory, all save/race/reconnect/disk-full stages, and Mac OS offline remained incomplete at this record. TTS included a Korean misrecognition; this was not speech-quality acceptance. AI correction/effects/authenticated providers/direct ChatGPT were later work. Logs and screenshots remain under `test-output/caption-style-*`, `caption-rendering-*`, and `captions-*`; large media is local.

## Evidence and related records

- [2026-09-05-caption-correction-results.md](2026-09-05-caption-correction-results.md)
- [manifest.json](../../assets/fonts/manifest.json)
- [OFL.txt](../../assets/fonts/OFL.txt)
- [2026-09-05-caption-rendering.json](results/2026-09-05-caption-rendering.json)
- [2026-09-05-caption-style-ui.json](results/2026-09-05-caption-style-ui.json)
- [2026-09-05-caption-style-offline.json](results/2026-09-05-caption-style-offline.json)
- [README.md](README.md)
- [2026-09-05-caption-effects-validation-plan.md](../plans/2026-09-05-caption-effects-validation-plan.md)
