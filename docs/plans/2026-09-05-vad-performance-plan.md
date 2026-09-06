# Long-video speech-protection performance

Measure optional local VAD on 1080p30 H.264/AAC 48 kHz, 10 and 60 minutes, three runs per Chrome/Mac condition after a 60-second runner smoke test. Lower repeated Korean Eddy TTS below the amplitude threshold so VAD must create kept ranges. This tests inference paths, not real pronunciation, CER, or editing-time savings.

- Measure from just before file selection through upload/native inspection, hashes, waveform, frame schedule, VAD, and editable cuts; target ≤20% of source duration.
- Measure export click through complete decode validation and save readiness; target ≤ source duration. Final copy to the user's chosen path is separate.
- Sample union RSS of Chrome+server or Mac and all child processes every 250 ms, excluding the driver; preserve sample errors and phase maxima. Target ≤2 GiB.
- Measure 32 restore/undo, 32 settings, and 32 play/pause operations per run. Include Playwright overhead from call through expected state and two frame updates. Each operation group's p95 must be ≤200 ms; do not calculate p95 from three media runs.
- After the first run, cancel actual VAD. Require visible cancellation ≤300 ms and server completion/UI retry ≤5 seconds, preserving the entire saved project. The next full run proves retry completion. Skip cancellation in one-run smoke checks.
- Verify real Silero use, decoded sample counts, valid intervals, output duration/full decode, repeated interval identity, and unchanged source hash. Low amplitude plus generated VAD ranges is not an independent pronunciation oracle.

Use a fresh app for the first run and the same app for the next two. OS caches remain; do not call it cold-cache. Do not close user apps or change global cache/network settings. Avoid concurrent media tests/builds; record power/hardware/tools/app/model/fixture hashes.

Threshold-only 1,000-cut performance, long caption/effect composition, and OS cold-cache remain separate. [Initial results](../testing/2026-09-06-vad-performance-results.md): 12 runs and four cancel/retry conditions completed, but all six browser RSS measurements failed. [Render-memory change](2026-09-06-render-memory-plan.md) and [rerun](../testing/2026-09-06-render-memory-results.md): the same matrix met targets. Preserve the initial failures.
