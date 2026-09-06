# Local model download cancellation and recovery

2026-09-06. T05 download cancellation/recovery was unverified. The setup script already uses fixed hashes, byte limits, temporary files, and rename, but SIGINT/SIGTERM did not trigger cooperative cancellation. Default process exit does not guarantee asynchronous `finally` cleanup; reproduce using real child processes.

Extract the downloader into a testable module while preserving SHA-256, maximum bytes, unique temporary files, and atomic replacement after validation. Pass AbortSignal through downloads and existing-file hashing. Handle SIGINT/SIGTERM only during download, clean up streams/files before exit, and report cancellation with codes 130/143.

Reuse verified existing files with zero HTTP requests. HTTP errors, truncation, oversize, hash mismatch, and pre-commit cancellation preserve the existing target and remove only this operation's temporary file. Successful rename after verification is the commit point: later cancellation does not roll back that verified file, but stops remaining setup; the next run verifies/reuses it.

SIGKILL cannot promise asynchronous cleanup. Verify leftovers are never used as the official model and the next run uses a fresh temporary file and validates before finishing. Do not search for and delete another operation's files. CMake process-tree cancellation, clean-Mac installation, and every remote-server failure remain outside scope; do not modify the installed model/runtime/package.

Preserve the original setup script. Compare pre/post behavior in child processes against a local HTTP server serving small synthetic bytes into test-only directories. Confirm actual transfer and writes before signaling. Cover success, hash reuse with zero requests, wrong hash, oversize, HTTP failure, interrupted body, pre-abort, SIGINT/SIGTERM mid-write plus retry, and SIGKILL plus retry. Record target hashes, exit codes/signals, temporary-file sizes, requests, and connection closure.

Run after ongoing long-media tests finish. Do not use real inference models, global tools, or account authentication. Credit passing cases only to the relevant T05 download conditions, not complete setup/transcription validation.
