# Local sound-effect editing results

Executed 2026-09-05 after `eecfe38`. FX01–FX03 and part of FX05 were exercised; AI proposals and human listening were later work.

Browser upload/native selection supports source placement, asset offset, duration, gain/mute, add/delete/exclude, undo/redo. Protect unapplied input before selection/close/render and window exit. Initial limits: one audio track, mono/stereo, 0.01–300 seconds and ≤1 GB per asset, 32 assets/128 clips per project, default −12 dB and at most three seconds, gain −60 to +12 dB. Generated WAV/MP3/M4A/AAC/FLAC/OGG each rendered; this is not every codec/channel combination.

Source-time starts inside cuts are omitted and restored with cuts. Retained starts map to edited time and end at the earliest asset remainder/user duration/video end. Range preview clips the complete mix, retaining tails that started earlier. Project v5 stores SHA-256 identity/edits, not runtime paths; v1–v4 migrate with no effects. Reject wrong reconnects and recheck hashes before output. Missing/changed assets require reconnect/exclude/mute. Native saves protect registered effect sources too.

Encoded preview/MP4 include effects; fast seek preview does not. Edits invalidate prior renders. Convert effects to selected output sample rate/channels; tested numeric cases used matching mono/stereo combinations, not subjective multichannel spatial quality. Mix 4,096-frame blocks with decoded assets in job directories. Check PCM and decoded final AAC sample peaks; either exceeding 0 dBFS prevents success. No automatic normalization/limiting and no true-peak/loudness certification. Plain output's existing behavior is unchanged.

Restrict probing/decoding to local files and WAV/MP3/MOV/FLAC/OGG/AAC demuxers. Disguised WAV playlists and real M3U8 generated zero external requests. Format-probe rejection and explicit allowlist rejection were tested separately.

| Check | Passes |
| --- | ---: |
| Units | 57 |
| Effects | 13 (four overlapping units + nine integration) |
| API | 12 |
| Media | 8 |
| Captions | 15 (nine overlapping units + six rendering) |

92 unique checks; build/package, both-app E2E and viewed desktop/390 px/Korean frames separate. Environment: Node 24.14.1/Electron 44.2.0/macOS arm64/FFmpeg 8.1.1.

## Independent output measurements

Original 48 kHz/1 kHz PCM beep and eight-second silent-audio H.264, flash at source four seconds, cut `[2,4)`. Expectations use independent arithmetic.

| Signal | Expected | Observed |
| --- | --- | --- |
| First effect | `[2,2.5)` s | `[2.000021,2.5)` |
| −6.0206 dB effect | `[3,3.5)`, amplitude ratio 0.5 | `[3.000021,3.5)`, RMS ratio 0.500634 |
| End-limited effect | `[5.8,6)` | `[5.800021,6)` |
| Final peak | ≤0 dBFS | −13.8777 dBFS, zero over-range samples |
| VFR/+5 PTS/44.1 kHz asset | `[2.1,2.5)` | `[2.100021,2.5)` |
| Stereo overlap/asset offset | 48,000 frames × two-channel oracle | Every sample error <1e−7 |
| PCM-mix cancel cleanup | <5 s, prior file preserved | About 3.20 ms, retry PASS |

Detect AAC edges at absolute amplitude >0.005 with predeclared 1/30 s tolerance. One-sample beep offsets do not establish perceptual accuracy for arbitrary sounds; one short cancellation is not p95.

Both-app UI output: source start 5 s, offset 0.1 s, duration 0.7 s, −7 dB plus separate muted clip → edited `[3,3.7)`, RMS 0.063141867, peak 0.092515111, checked silence peak zero. Captioned/effect MP4 fully decoded; zero observed external requests/page errors, no new OS block test. Runner now waits for actual React undo values before checking/screenshots; future-version rejection moved from newly supported v5 to v6.

Synthetic FX01–FX03 passed. FX05 still lacked human listening, every OS/save fault, and long performance; do not mark complete. Real assets, additional codecs, Korean quality/time, authenticated AI and other product gates remained unverified. Large local outputs/logs/screenshots use `test-output/effects-*` and are excluded from Git.

## Evidence and related records

- [2026-09-05-caption-effects-validation-plan.md](../plans/2026-09-05-caption-effects-validation-plan.md)
- [2026-09-05-ai-effects-results.md](2026-09-05-ai-effects-results.md)
- [ffmpeg-formats.html](https://www.ffmpeg.org/ffmpeg-formats.html)
- [ffmpeg-protocols.html](https://ffmpeg.org/ffmpeg-protocols.html)
- [2026-09-05-effects-integration.json](results/2026-09-05-effects-integration.json)
- [2026-09-05-effects-ui.json](results/2026-09-05-effects-ui.json)
