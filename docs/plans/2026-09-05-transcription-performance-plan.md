# Long transcription performance plan

Execute T07 with real Whisper small, CPU four threads. Smoke-test 60 seconds, then transcribe 10-/60-minute inputs in Chrome/local server and packaged Mac, three times each. Targets: processing ≤ source duration, app/child RSS ≤4 GiB, interaction p95 ≤200 ms, visible cancellation ≤300 ms, ready to retry ≤5 seconds.

Generate original Korean sentences with installed Eddy TTS and repeat them only to the specified duration with simple 1080p30 H.264/AAC 48 kHz video. This synthetic repeated material does not represent human accuracy or complex visuals.

Open the actual app, import media, open an existing-caption project, and retranscribe. Measure request preparation through model checking, decoding, inference, and displayed results; record import separately. Sum dedicated Chrome plus server process trees or the whole Electron tree, excluding the driver. Sample RSS every 250 ms, record failures, and acknowledge unobserved inter-sample peaks.

Start a fresh app for the first run, then reuse it twice. Do not purge OS caches or call the first run cold-cache. During inference, select existing captions at least 30 times and measure real input through selected-state update and the next animation frame; this does not characterize every UI action.

Cancel actual inference in each condition and verify preserved captions/project, process cleanup, and retry. Keep cancellation separate from completed timing. Persist raw time/RSS/progress/cue counts/ranges/model identity/failure reasons immediately. Report median/maximum after three completed runs without hiding failures or relaxing limits. Long VAD and caption/effect composition remain separate.
