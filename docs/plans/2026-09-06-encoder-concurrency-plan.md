# Limiting repeated video encoding concurrency

2026-09-06. Windowed-list candidate `3d572b4` failed the third 60-minute run at 2.008 GiB union RSS. All peaks were in export; FFmpeg used about 343–348 MiB. Server/renderer growth also occurred, so the entire increase is not attributed to an encoder leak.

Compare a video-encoder maximum of two threads instead of four, retaining CRF 18/veryfast, resolution, frames, cuts, captions, effects, AAC, and preview CRF 25/ultrafast. Apply to captioned and plain exports; one-CPU hosts still use one. UI/formats/scope stay unchanged.

[FFmpeg documents](https://ffmpeg.org/ffmpeg-codecs.html#libx264_002c-libx264rgb) threads and CRF separately. Thread changes do not guarantee identical pixels/bitstreams for every input. Earlier 60-second diagnostics preserved synthetic expectations/sample pixels but changed MP4 bytes; compare all decoded frames and report timing costs.

1. Sequentially compare baseline and candidate with the same 60-second backend composition. Preserve RSS, render/verification time, all frame counts/PTS, captions/effects/sync/SRT, hashes, and full decoded-frame comparison.
2. Run actual media/boundary/compatibility/caption/effect integration plus units/build/package. Avoid a test that merely copies thread arguments. Exercise both apps' short composition/save/cancel/retry.
3. Freeze the candidate commit; run three 60-minute browser repetitions in one app. Require analysis ≤20%, export ≤100% of duration, RSS ≤2 GiB, each UI p95 ≤200 ms, cancellation ≤300 ms and retry ≤5 s. Stop expanding long conditions after a completed failure.
4. If passing, finish remaining 10-/60-minute repetitions in both apps. Cold-file-cache, real Korean quality/transcription/time savings, authenticated AI, and native OS network blocking remain separate.

Preserve failures and investigate server/browser resource lifetime if overages remain. Do not force GC, disable browser features, or relax memory criteria.
