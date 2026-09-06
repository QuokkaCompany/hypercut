# Forced termination during native project save

Earlier E03 killed a standalone process using the atomic-save function. This test uses the packaged Mac app's actual button, IPC, and save path, then SIGKILLs its main process. Use generated media and temporary projects, separately from transcription benchmarks. Only dialog path selection is substituted; actual OS replacement confirmation belongs to E04.

1. Open a v7 project with cuts, captions/end review, style, and glossary; create a baseline through the real save button.
2. Edit settings and save again. Put a test barrier immediately before filesystem rename, after temporary writing and fsync. Do not replace the product save function.
3. Confirm no success message and a dirty state, then SIGKILL. Verify main/child termination, unchanged destination bytes/hash, and unchanged source.
4. Reopen in a new packaged app, reconnect the source, compare all fields, and save again.
5. Repeat immediately after the real rename but before IPC success. The destination must contain the complete new project and reopen successfully.

Both points require zero corrupt final files, false save success, or source changes. Record leftover temporary files separately; do not auto-adopt them or delete user files. This does not test power loss, hardware failure, browser download completion, or native replacement dialogs. Update E03 evidence after execution.
