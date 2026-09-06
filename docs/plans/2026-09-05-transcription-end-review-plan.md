# Transcription end-boundary recovery and review

A real 60-minute Whisper run returned 580 cues, with the last at 3,596.240–3,600.240 seconds, failing the complete transcript despite an exactly 3,600-second WAV. The same CLI settings reproduced it; raw evidence: `test-output/transcription-end-diagnostic/raw.json`.

The [pinned engine](https://github.com/ggml-org/whisper.cpp/blob/371b5a7561823ab2bb32142d2751e35e7534727b/src/whisper.cpp) uses 30-second padding and timestamp tokens. Handle narrowly bounded final-window overflow during import; do not loosen general project/render validation.

Clamp only cues starting inside the source and its final 30-second window, with both overflow and cue duration at most 30 seconds. Reject out-of-source starts, larger errors, overlaps, and malformed data. Preserve the original end in `timingWarning`; do not delete/replace text or auto-confirm review.

Mark the affected cue for end review with a distinct reason, reusing review history. The user listens, corrects wording/timing, and explicitly confirms. Retained unreviewed cues block SRT and captioned preview/MP4; source-listening VTT remains available. Review state must persist/invalidate correctly through save, undo, AI correction, and cuts.

Project v7 preserves warnings and migrates v1–v6 while retaining existing cut-review keys. Older apps must not open v7 and silently drop warnings. Freeze a regression from actual raw output; test blocking, confirmation, edits, cancel, round trips, and both apps' real SRT/MP4, then rerun 10-/60-minute performance on the new build. Clamping is not a speech-accuracy or clipped-word recovery claim.
