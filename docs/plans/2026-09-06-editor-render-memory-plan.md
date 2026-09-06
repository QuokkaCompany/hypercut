# Reusing editor rendering during progress updates

[Baseline](../testing/2026-09-06-thousand-cut-performance-results.md): Chrome's third 60-minute/1,000-cut run reached 2.050 GiB RSS. FFmpeg stayed around 407–409 MiB while renderer RSS rose roughly 405→437→482 MiB. This alone does not prove a leak.

`App` progress/playback/settings updates rebuild 1,000 cut rows and timeline waveform/cut elements. First compare memoized rows, stable state-dependent handlers, and reusable waveform/tick/cut layers. Retain all elements, scrolling, keyboard/selection behavior, and file format. Virtualization and lower encoder concurrency are separate later options.

Progress-only updates should reuse static layers while job locks change immediately. Edits/restores/undo/redo/source/project changes must update rows/selection. Source/edited/rendered views and seeks always use current ranges; stale closures fail the contract. Preserve zoom/drag/waveform/playhead and existing save revision/race handling.

Finish/audit the 12-run baseline before modifying the app or overlapping media jobs. Apply candidate, run unit/build and both-app behavior/save/job-race regressions, then repeat the failing Chrome 60-minute three-run condition with identical runner/fixture. Compare analysis, complete project, output length/markers, and unchanged encoder/quality. Only expand to remaining conditions after meaningful improvement and functional passes; keep 2 GiB and existing time/UI/cancel limits.

## Candidate outcomes and diagnosis

Candidate 1 passed 54 functional runs but failed repetition three at 2.172 GiB. Analysis/projects and all three output bytes matched baseline. Candidate 2 reused individual cut rows and separated waveform backgrounds, retaining all buttons and Space/Enter; it also failed repetition three at 2.145 GiB. The remaining nine long runs were not started. Preserve [results](../testing/2026-09-06-editor-render-memory-results.md).

After failure, compare browser/renderer/GPU/server/media children at peak, then separately instrument DOM/listeners/JS heap around import/analyze/export/save/interactions. Stable heap does not turn failing RSS into a pass. Diagnostic overhead is not part of formal runs. Do not force GC, restart between repetitions, lower quality, or add speculative caches.

An initial diagnostic after 288 actions found stable DOM and non-monotonic used heap but high renderer RSS. Investigate playback, automation lookup, and repeated import/export resource lifetime without claiming a cause.

## Selector-overhead comparison

Keep source/build/media, 288 actions, real clicks/input, and state assertions; change only `getByRole` versus CSS lookup. Initial CSS final renderer RSS was about 396 MiB versus 543 MiB in a separate role run. Reproduce with the same diagnostic revision before attributing causation.

A formal optional CSS mode must target the same buttons by actual aria-label and inputs by type/name, retain Playwright interactions, and never invoke internal app functions. Keep 10/60 minutes, both apps, three repetitions, 1,000 cuts, 96 actions/run, analysis/export/save/cancel and independent decoding/sync. Preserve source/settings/quality/full-state comparisons and all targets. Report raw union RSS without subtracting estimated automation cost, force-GC, or extra restarts. Record selector mode and runner hash, verify identical product/package, and review runner-only changes. A CSS pass does not erase role-based failures or constitute a product memory fix; accessibility/name checks remain separately evidenced.

Real Korean quality, cold-cache, long caption/effect composition, and authenticated AI remain unverified by this change.
