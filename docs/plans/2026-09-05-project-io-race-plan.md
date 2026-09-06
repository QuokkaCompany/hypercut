# Project read/save response races

E06 follow-up: reversed file-read/native-save completion must not lose the latest project or edits. Use generated media and temporary files after other transcription performance work finishes.

| Case | Order | Expected behavior |
| --- | --- | --- |
| READ_LATEST | Hold A read; open B; complete A | Keep latest B; ignore stale A completion/error |
| READ_LATEST_ERROR | Open B; fail held A read | No old error applied to B or later saves |
| READ_EDIT | Edit current project while A read waits; complete A | Preserve later edit and dirty flag; explain reopening if needed |
| SAVE_EDIT | Hold native save at −41; edit to −42; complete save | File contains −41 snapshot; UI retains −42 and dirty flag; resave works |
| SAVE_PROJECT | Hold A save; open/edit B; finish A | Save A snapshot; preserve B edits/dirty state without false B success |

Run the three read cases in Chrome and Mac. Native saves use actual button/IPC/serialization/write/rename, with a barrier before rename. Browser tests delay the actual `text()` result or return a controlled read error. Preserve pre-fix evidence and rerun identical orders after correction. SAVE_EDIT also covers duplicate button/shortcut prevention and rejecting the source path while preserving dirty state/retry; distinguish these additions from the initial six reproductions.

Invalidate reads by file-selection and edit sequence. Preserve edits during saves and prevent concurrent duplicate saves. Keep format/content unchanged. Canceled analysis/new-source races, actual OS replacement dialogs, and browser download-manager completion remain separate tests.
