# First-run and input-file cache validation

2026-09-06. Refines the [validation plan](2026-09-05-validation-plan.md) after the two-thread encoder candidate passed its 12-run matrix. Retain earlier memory failures.

| State | Required observation | Does not establish |
| --- | --- | --- |
| New app session | New test profile/process with no old jobs | OS input/executable cache state |
| Nonresident input file | All file pages have zero `mincore` residency immediately before first read | Executable/library/metadata/device cache state |
| Resident input file | Count pages after reading and immediately before reuse | Permanent future residency |
| Whole-OS cold cache | Separate preparation and observation | Cannot be inferred from file-level conditions |

Never call a new process cold-cache without cache evidence.

## File controls

[`file-cache-probe.c`](../../scripts/helpers/file-cache-probe.c) creates only a new test-owned 32 MiB file with `O_EXCL`, uses page-aligned `F_NOCACHE` writes, and observes `mmap`/`mincore` without reading mapped data. Observe twice, then verify every byte with ordinary `pread`, and observe again. [Recorded probe](../testing/results/2026-09-06-file-cache-probe.json): 2,048 ×16 KiB pages; 0 resident before, 0 on repeat inspection, all 2,048 after reading. Warnings-as-errors compilation and execution passed; hashing occurred after warming. No app/media run was involved.

```sh
clang -Wall -Wextra -Werror -O2 scripts/helpers/file-cache-probe.c -o /tmp/hypercut-file-cache-probe
/tmp/hypercut-file-cache-probe /tmp/hypercut-file-cache-control.bin
```

Use a fresh destination. Never overwrite files or change global caches/network/other apps. Sources: [Apple filesystem guide](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/FileSystem/Articles/FilePerformance.html), [mincore](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/mincore.2.html). Current behavior is established by the local controls, not assumed from archived docs.

[`file-cache.c`](../../scripts/helpers/file-cache.c) adds `copy`, `inspect`, and `warm`, opens sources read-only, creates destinations exclusively, and rejects existing paths, symlinks, empty files, directories, and FIFOs. Success exit alone is insufficient; inspect actual `residentPages`.

The first padded/truncated `F_NOCACHE` implementation left one resident final page for non-page-aligned lengths despite identical data; only exactly 16 KiB was nonresident. Preserve [failed control](../testing/results/2026-09-06-file-cache-copy-before.json). The accepted version uses per-destination `F_NOCACHE_EXT` without padding/truncation, supported by local SDK and Apple [header](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/fcntl.h)/[implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_descrip.c); unsupported SDK/OS must fail rather than silently substitute.

[Final controls](../testing/results/2026-09-06-file-cache-copy-controls.json), macOS 26.5.2 arm64/Apple clang 21: lengths 1/16,383/16,384/16,385/33,554,469 bytes all had zero pages after copying and repeated inspection; ordinary reads made all 1/1/1/2/2,049 pages resident. Then compare source/copy hashes and lengths. Existing-destination replacement and five rejection conditions preserved bytes. These are tool controls, not app runs.

```sh
python3 scripts/file-cache-controls.py test-output/FRESH_CACHE_CONTROL_DIRECTORY
```

The runner refuses existing result directories and preserves compiled tool, source, and raw observations.

## App integration

Prevalidate the synthetic source/oracle and hash separately from human data. Prepare a new byte-identical file through uncached writes, not APFS cloning. Observe every page immediately before selection without hashing/probing/thumbnailing the copy first. Cold requires zero residency; warm requires all pages after ordinary reading. A mismatch fails that condition; do not silently retry under a new name or relabel it.

Measure normal file selection through complete import/analysis including upload, decoding, waveform, and frame indexing against the 20% target. File preparation/inspection time is reported separately. Preserve normal import even though internal uploaded/session copies may become cached. This tests the selected source's cache, not every internal decoding cache.

`composition-benchmark.mjs` accepts optional `--input-cache=cold|warm`; omitted preserves the previous path. [`file-cache.mjs`](../../scripts/helpers/file-cache.mjs) compiles the C helper into each result directory and records compiler/source/binary hashes. Do not edit an active runner. Prepare a fresh same-name/same-byte copy per repetition; log inspection start/end and selection time. Inspect residency after analysis before hashing, then check source/copy identity again after work. Preserve failed observations.

Keep independent MP4/SRT/project/cancel checks, union child-process RSS, and all original targets. Record new-process state, power/OS/product/tools/fonts, preparation costs, and observation-to-selection gap. If selection automation reads first, adjust the boundary and cannot claim cold without pre-first-read evidence. Three runs per app/cache condition yield raw values, median, and max, not p95. Residency is a point-in-time observation, not a guarantee of future OS behavior.

Validate normal/invalid observations and file preservation in short controls, then 60-second cold/warm composition/cancel/retry twice in each app. Only then run 10/60 minutes × both apps × cold/warm × three sequential repetitions, with a new app per condition and reuse within its three runs.

## Recorded progress and remaining scope

[Controller checks](../testing/results/2026-09-06-file-cache-controller.json): nine passes, including cold/warm, premature reads/hash rejection, destination preservation, changed input after analysis/work, and malformed observations. [App controls](../testing/2026-09-06-input-cache-results.md): four ordinary 60-second runs and eight cold/warm runs preserved output/save/cancel/retry and correct preselection residency. Browser 60-minute cold and warm three-run conditions also completed.

Of the 24 long composition conditions, 18 remain unexecuted at this record's date. Whole-OS cold-cache, human Korean quality/CER/editing-time savings, native OS network blocking, and authenticated AI remain separate. Threshold-only work follows its [own plan](2026-09-06-thousand-cut-performance-plan.md); synthetic success does not satisfy those other gates.
