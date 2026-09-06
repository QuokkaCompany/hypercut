# Transcription end-overflow reproduction and recovery

Executed September 5, 2026, after `877e2d5`. The first 60-minute Chrome transcription failed timing validation. Six earlier 10-minute successes and failure logs remain in `test-output/transcription-performance-initial-failure/`.

The decoded input had 57,600,000 samples at 16 kHz, exactly 3,600 seconds. Repeating actual Whisper small / whisper.cpp 1.9.3-dev inference with identical CLI settings produced 580 cues. The last interval was `[3596.240, 3600.240)`, extending 240 ms beyond the source. The previous converter rejected overflow above 100 ms and discarded otherwise valid results. The pinned implementation uses padded 30-second windows and timestamp tokens; the overflow itself was measured from raw JSON.

The converter now accepts only final-window cues that start inside the source and whose duration and overflow are at most 30 seconds. It still rejects outside starts, excessive, inverted, overlapping, or corrupt timings. Project and output intervals retain `0 ≤ start < end ≤ duration`. All 580 texts and starts were preserved; only the final end was clamped to 3,600, with the original 3,600.240 retained in `timingWarning`. Text is not automatically truncated or marked reviewed.

The UI flags the end for review and navigates to source playback. In-range source VTT remains available. Until explicit wording/end confirmation, a retained warning blocks SRT, captioned preview, and MP4. Manual or AI text/boundary changes invalidate review; a fully cut cue is omitted. Undo/redo and v7 persistence retain the warning and review state. Migration from v1–v6 preserves previous cut-review keys and glossary data.

## Executed checks

Seventy-five unit tests, four actual-transcription integrations, and 15 caption tests passed, with overlap removed for 85 unique automated checks. Build and packaging passed. Reprocessing the actual 580-cue raw JSON preserved all cues, produced one warning, and ended at 3,600 seconds. This is distinct from rerunning 60-minute app inference.

Both apps passed a short synthetic reproduction of the 240 ms overflow, including VTT, navigation, editing, review, undo, AI invalidation, save/reopen, and server output blocking. After review, SRT included `00:00:10,240 → 00:00:14,000`, and the 14-second MP4 fully decoded. A Korean frame at 13.5 seconds and Chrome/Mac/390 px layouts were viewed. No page errors or external requests were recorded.

Four flows in each app passed: end review, actual Whisper/caption design, glossary, and effects. Mock AI does not prove actual model quality. Effect RMS was approximately 0.06314, peak 0.09252, and the silent region zero.

The benchmark now rejects existing output folders before launch, preserves failure elapsed time, stage, RSS, and error values, and records warning counts. Rejection of a reused folder preserved its files. Later candidate `1e927ff` completed 12 long runs, with a separately documented click-runner failure after nine and a corrected three-run Mac continuation. Those original failures remain recorded.

End clamping does not restore clipped words or guarantee wording. Human quality, authenticated AI, other long modes, and remaining OS/offline conditions require separate evaluation.

## Evidence and related records

- [2026-09-05-transcription-end-review-plan.md](../plans/2026-09-05-transcription-end-review-plan.md)
- [2026-09-05-transcription-end-diagnostic.json](results/2026-09-05-transcription-end-diagnostic.json)
- [2026-09-05-transcription-end-ui.json](results/2026-09-05-transcription-end-ui.json)
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/371b5a7561823ab2bb32142d2751e35e7534727b/src/whisper.cpp)
- [cli.cpp](https://github.com/ggml-org/whisper.cpp/blob/371b5a7561823ab2bb32142d2751e35e7534727b/examples/cli/cli.cpp)
- [2026-09-05-transcription-end-regressions.json](results/2026-09-05-transcription-end-regressions.json)
- [2026-09-05-transcription-performance-results.md](2026-09-05-transcription-performance-results.md)
