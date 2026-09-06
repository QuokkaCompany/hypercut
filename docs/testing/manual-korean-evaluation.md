# Human evaluation of Korean recordings

This guide and its empty CSV templates are preparation, not completed evaluation. Human recordings, labels, and editing sessions have not been collected. Q01–Q05 and human-recording transcription quality remain `NOT_RUN`. Follow the [validation plan](../plans/2026-09-05-validation-plan.md) and [test cases](../plans/2026-09-05-test-plan.md).

## Prepare independent datasets

Use only recordings explicitly designated for evaluation. Keep originals, reference transcripts, personal paths, and completed forms in ignored `test-output/private-evaluation/` or another designated private folder. Commit only anonymous video IDs, settings, aggregates, and failure explanations. Do not search unrelated personal folders.

Separate tuning recordings R01–R03 from at least six evaluation recordings R04–R09. Each should last 5–15 minutes, covering quiet recordings, low-volume speech, household noise, and little or no silence. Record the original recording ID so excerpts from one recording cannot appear in both sets. Record tracks, channels, codecs, and actual frame timestamps. Treat unsupported media as separate compatibility cases.

1. Listen to the original and manually label speech, removable pauses, and ambiguous intervals. Automatic cuts and transcripts are not reference labels.
2. Choose settings and optional speech protection using only the tuning set. Initial defaults are not validated recommendations.
3. Freeze settings and label versions/hashes before evaluation. If evaluation results influence tuning, move those recordings to the tuning set and replace the evaluation set.
4. Give amplitude-only and speech-protected comparisons separate run IDs. Do not aggregate only the favorable result for each recording.

## Source-timeline labels

These are empty UTF-8 CSV headers. Times are seconds from source start, using half-open intervals `[start_seconds, end_seconds)`, never output-video times.

```csv
video_id,recording_id,split,condition,duration_seconds,track_index,channel_index,source_sha256,label_version,label_sha256
```

Use `tuning` or `evaluation` for `split`. Record mixed conditions at interval level too.

```csv
video_id,label_id,start_seconds,end_seconds,label,condition,reviewer,reviewed_at,notes
```

Use `speech`, `removable_pause`, or `ambiguous` for `label`. Resolve conflicting labels before execution. Unlabeled time has no reference answer; it is not automatically silence. Report its duration and cause, and withhold an overall quality PASS if the evaluation remains incomplete. Exclude ambiguous intervals from the precision denominator as specified in the plan, but report their count and duration.

Derive target removable intervals independently by applying the frozen minimum duration and speech padding to human pause labels. Do not derive targets from app cuts. Link the derivation rules and label version in the results.

## Listen to cuts and record restoration

Listen to at least one second on both sides of every automatic cut. Expand uncertain boundaries and alternate original/output playback order. Judge clipped words and syllables by listening, not label intersections or transcript strings alone. Finally, play the entire output.

```csv
run_id,video_id,cut_id,source_start_seconds,source_end_seconds,reviewed,boundary_result,restored_for_quality,reason,review_active_seconds
```

Use `preserved`, `clipped`, or `undecided` for `boundary_result`. Record every cut's review state and full-playback completion. Unreviewed or undecided cuts cannot pass. Count each original cut ID only once in the restoration-burden numerator, even if restored repeatedly. Distinguish exploratory restoration from cuts finally restored to repair quality.

Merge overlapping time intervals before calculating totals. Removal precision is the proportion of evaluable removed time overlapping removable pauses. Pause-removal recall is the proportion of independently defined target time actually removed. Report numerators, denominators, excluded ambiguous time, per-video results, and pooled totals. A zero denominator is `N/A`. Targets remain zero clipped words/syllables, at least 99% precision, at least 90% target-pause removal, and at most 5% quality-related restoration burden.

## Compare active editing time

Practice on separate material, then assign the comparison order in advance. Start half the recordings in the existing editor and half in HyperCut, recording the interval between sessions. Apply the same completion criterion: clean up pauses, repair speech damage, review the full result, and finish MP4 export.

```csv
run_id,video_id,editor,editor_version,order,session_started_at,activity_started_seconds,activity_ended_seconds,activity,notes
```

Use `active_editing`, `analysis_wait`, `export_wait`, or `away` for `activity`. Times are elapsed seconds from session start. Active editing includes setup, review, restoration, and error recovery. If work overlaps automatic waiting, retain both intervals but calculate active time from the union of active intervals. Do not add waiting again. Report unrelated absence separately and retain total elapsed time.

```csv
video_id,manual_run_id,hypercut_run_id,manual_active_seconds,hypercut_active_seconds,manual_elapsed_seconds,hypercut_elapsed_seconds,quality_status,time_saved_ratio,exclusion_reason
```

Time saved is `1 - HyperCut active time / existing-editor active time`; the target is a median of at least 50% across videos. Include only quality-passing pairs in that calculation, but disclose excluded recordings and reasons. Excluding a recording for damaged speech does not make the quality gate pass. Zero denominators and missing measurements are `N/A`. Report elapsed time, order, and learning effects from repeated editing separately.

## Transcription evaluation and reporting

Follow the [transcription/caption plan](../plans/2026-09-05-caption-effects-validation-plan.md): at least six evaluation excerpts totaling at least 30 minutes, with its normalization rules, CER numerator/denominator, and condition-specific targets. Keep the 50% silence-editing time target separate from the 30% caption-work target. Write reference transcripts before viewing app output, preserving numbers, units, negation, and technical terms.

Complete Q01–Q05 individually in the [run template](test-run-template.md). Link code/package/settings/label versions, completed recording counts, unexecuted or undecided cases, full-playback and boundary-review coverage, numerators/denominators, and raw timing values. Creating these instructions and empty headers does not constitute evaluation.
