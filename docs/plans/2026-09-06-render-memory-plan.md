# Render memory improvement and regression plan

[Baseline](../testing/2026-09-06-vad-performance-results.md): all three browser runs at both 10 and 60 minutes exceeded 2 GiB, peaking during export. Compare an encoder limit of min(logical CPUs, 4), preserving settings, cuts, codecs, resolution, CRF, and preset.

1. Identify current app/package and baseline hashes; change only the encoder thread cap.
2. Package and run one 10-minute browser check for direction, not a three-run performance pass.
3. Regress real CFR/VFR, PTS, selected tracks, short/partial output, caption styles, rotation/SAR, effect placement/gain/cancel, and normal editing in both apps. Check duration/markers/frames/independent PCM/full decode/source preservation.
4. After meaningful improvement and regression passes, rerun 10/60 minutes × both apps × three runs and four cancel/retry conditions with the same VAD runner/fixtures. Compare time, union RSS, and UI response.
5. Preserve raw failures and compare source/model/runner/app/package hashes. Continued overages remain failures requiring investigation.

Synthetic Korean/simple 1080p input does not represent all recordings, CPUs/platforms, cold caches, long caption/effect composition, or current 1,000-cut performance. Thread limits do not guarantee byte-identical bitstreams. [Completed rerun](../testing/2026-09-06-render-memory-results.md) met the same 12-run targets and records increased export time.
