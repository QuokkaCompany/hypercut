# Editor-specific cancellation and new-source races

Extend analysis/export races to transcription, SRT, partial restoration, and effect-inclusive preview. Use generated Korean TTS with actual Whisper and real server-generated results.

Hold each completion poll, cancel, open source B, and start its preview. Releasing A must preserve B's cuts, captions, glossary, effects, dirty state, and active work. Also test a delayed cancellation response replaced with 503. Canceled A SRT must not trigger a download/native save request. Reconnect actual effect assets and compare distinct A/B placements in saved projects.

Include closing the caption editor during transcription and canceling SRT inside it. Opening new media remains disabled until cancellation cleanup permits it. For transcription and SRT, fail the current cancellation with 503 while holding polls: show the error and re-enable cancellation for a second attempt. Clear cancellation-in-progress only for the still-current job, retaining stale-job protection.

Run four jobs × two delayed orders × two apps = 16 cases, plus two current-cancel retry cases × two apps = four: 20 new runs. Retain the existing 14 baseline races. Native paths are supplied by the test; this does not establish OS dialog operation, human recording quality, or authenticated AI.
