# Clips, transcripts, and multilingual captions

Baseline: `adf0624`. The user approved source-range clips/transcript extraction and requested multilingual support. Preserve the previous build's 24 threshold-performance passes as evidence for that build only.

## Scope and persistence

Export source-time MP4 ranges with the existing cuts/captions/effects renderer at export resolution/quality. Consecutive transcript sentences populate the same clip dialog. Display the final frame-aligned range and edited duration, using identical kept intervals for video/audio.

Export full-source or edited UTF-8 TXT in browser and native save flows. Full includes all recognized sentences; edited includes retained cues and requires existing cut-boundary review for partially cut sentences.

Distinguish transcription from translation. Reuse multilingual Whisper for Korean, English, Japanese, Chinese, Spanish, French, German, Portuguese, Italian, Russian, and automatic detection. Language selection support is not language-specific accuracy validation. App menus remain Korean; multilingual scope covers recognition and captions.

Translation uses the selected local/API/subscription connection or manual chat/MCP proposals, with comparison and selected application. Send selected text, language, and instructions only. Settings save does not infer; failure/cancellation does not switch providers. Process at most 20 cues/4,000 characters from the current cue, with navigation to the next untranslated cue.

Preserve source text/timing and per-language translations in project v8; read v1–v7 unchanged. Track source, translation, source snapshot used for translation, and output language separately. Applying/editing translations and selecting output language participate in undo/redo and round trips. Retranscription does not attach old translations to new cues. Source changes make old translations stale; missing/stale output translations require resolution before SRT/TXT/captioned MP4.

Bundle multilingual fonts and validate glyph support rather than exporting missing-glyph boxes as success. Project/track/text/range changes invalidate old translation/export responses.

## Validation

| Layer | Checks | Evidence |
| --- | --- | --- |
| Domain | Languages, source/translation preservation, staleness, full/edited TXT, v1–v8 | Fixed expectations, forbidden-response rejection, round trips and undo |
| Actual media | Arbitrary/sentence clips with captions/effects, multilingual SRT/TXT | Full MP4 decode, range/sync, UTF-8 and glyph rendering |
| Actual transcription | Selected languages and auto detection | Real engine arguments/results/timing; distinguish TTS from human evaluation |
| AI contract | Provider/language/cue IDs, missing/duplicate/invalid responses, failures/cancel/stale | Mock provider/CLI/MCP scope and preserved source |
| Both apps | Clip/TXT save, translation/output language/edit/save/reopen | Actual Chrome and new Mac-package files and UI |

Complete related unit/integration and both-app checks before assessing long-run impact. Do not credit prior-candidate performance to new functionality. Real authenticated translation quality and human speech quality remain unverified without those accounts/data.
