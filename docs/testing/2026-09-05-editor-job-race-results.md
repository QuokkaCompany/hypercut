# Caption-editor cancellation retry and source preservation

Executed 2026-09-05 America/New_York. Reproduced on `1bb0057`, then verified corrected browser/Mac builds with identical runner hashes. Actual transcription/SRT cancellation failures cleared the internal cancel flag but left the progress text saying cancellation was underway. Because the caption editor disabled its button from that text, retry remained unavailable until a later poll. The main editor used a different condition, explaining the earlier coverage gap. All four pre-fix transcription/SRT × app cases reproduced it; this was not permanent lost work.

On failure for the current job, update progress to a retryable cancellation-error message. Preserve job-object/sequence checks that ignore old errors.

## Results

20 added cases passed: four job types (real Whisper transcription, SRT, partial restore, effect preview) × two delayed orders (completion or old cancellation failure after opening B) × two apps, plus transcription/SRT current-cancel retry × two apps. The 14 baseline races also passed: **34 total**. Six transcription branches used actual Whisper small/Eddy TTS and observed two returned cues, not human accuracy evidence.

SRT cancel occurred inside the caption dialog; ordinary transcription races closed that dialog first. New-source opening remained disabled during work and was used only after cleanup. Retry checked re-enabled controls and two actual DELETE requests. While B's new preview waited, old responses could not alter B's source/cuts/−42 dBFS/dirty flag/job/output state. Then B really rendered with its own result ID. Effect cases reconnected real WAVs with distinct A/B timing/gain and one mixed effect each.

Compare all saved project fields except save timestamp, including captions/style/glossary/effects. Zero unexpected downloads/native saves, changed source/asset hashes, page errors, or observed external requests.

Additional checks: 75 units PASS, type/build/package PASS, and two ordinary transcription/caption/style/SRT/MP4 and effects/reconnect/project/PCM flows in both apps (four UI runs). Product/package/source identities were audited.

This covers the named shared-job branches, not asynchronous effect-file import crossing an already pending project read, all E06 combinations, actual OS dialogs, new process-kill measurements, OS network isolation, human quality, or authenticated LLMs. A fulfilled intercepted canceled response does not prove app consumption; actual late cancellation JSON consumption was separately observed. Current-cancel retries used server-complete/UI-pending state.

```sh
npm run test:jobs:races -- --output=test-output/FRESH_RUN_NAME
```

Requires current Mac package, Chrome, local Whisper, Korean Eddy TTS, and FFmpeg. For the four retry cases append `--scenarios=CURRENT_CANCEL_ERROR_TRANSCRIBE,CURRENT_CANCEL_ERROR_CAPTIONS`. Never overwrite old results.

## Evidence and related records

- [2026-09-05-editor-job-race-plan.md](../plans/2026-09-05-editor-job-race-plan.md)
- [2026-09-05-editor-job-races-before.json](results/2026-09-05-editor-job-races-before.json)
- [2026-09-05-editor-job-races-after.json](results/2026-09-05-editor-job-races-after.json)
- [2026-09-05-editor-job-races-regressions.json](results/2026-09-05-editor-job-races-regressions.json)
- [2026-09-05-job-cancellation-race-results.md](2026-09-05-job-cancellation-race-results.md)
