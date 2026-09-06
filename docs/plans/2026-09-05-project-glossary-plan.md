# Project glossary implementation and validation

Persist and reuse caption-correction reference terms: project-specific free text up to 2,000 characters. This is not automatic replacement, a transcription-engine setting, or a global dictionary.

- Apply explicitly in the caption editor. Protect unapplied input on close/undo and require application before correction/output.
- Add one step to the caption/style undo history. A glossary-only edit marks the project dirty without changing media or captions.
- Store `glossary` in project v6. Migrate v1–v5 to empty terms. Reject missing/non-string/overlong/control-character v6 values while preserving current edits.
- Default the correction request to project terms. Allow temporary editing, clearing, or restoring the default without writing back. Preparing a request does not call a model.
- Send selected captions/terms only in explicit requests or copied prompts. Exclude paths, other projects' terms, and hidden fields. Changing request terms invalidates old proposals.

Test migration, malformed inputs, edit preservation, and request validation. In Chrome and packaged Mac, exercise apply, undo, unsaved-input protection, save/reopen, new-media reset, temporary overrides/clearing, and stale-proposal rejection. Regress correction/effects. Real glossary adherence and Korean accuracy require separately authenticated models and evaluation recordings.
