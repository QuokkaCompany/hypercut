# AI sound-effect proposal contract and validation

Baseline: local effect editing at `6c8026b`. Implements [FX04](2026-09-05-caption-effects-validation-plan.md). Mock proposals do not establish audio understanding or authenticated provider success.

## Request and application contract

The user explicitly selects at most eight assets, 32 existing clips, and optionally 20 reference captions/4,000 characters. Send asset aliases, user descriptions and durations; clip aliases, source placement, asset offset, duration, gain and mute; video duration and up to 2,000 kept ranges. Distinguish source and edited time. Do not send filenames, hashes, paths, video, or audio. Descriptions and captions are reference data, not executable instructions.

Each request has a UUID and at most 20 add/update/delete proposals. Apply both strict JSON schema and runtime validation. Updates/deletions may target only selected clips with exactly matching original values. Additions use reserved new IDs and selected assets. Reject the entire response for duplicate IDs/targets, wrong request, unknown assets, invalid time/gain, extra/missing fields, or invalid before/after combinations.

Proposals start unselected. Compare source/estimated edited placement, offset, length, gain, mute, and deletion; apply selected changes as one undo step. Encoded preview establishes final frame-aligned output. Show the actual audible range for deleted start points or tails beyond the end; do not move an effect to nearby speech automatically.

Revalidate the current media/cut/effect/reference-caption snapshot at application. Changed state needs a new proposal. Derive new clip identities from request UUIDs so replay cannot duplicate clips. Reuse existing provider/manual JSON paths and their shared single active request, cancellation, deduplication, disconnect, and stale-response protection. No automatic retry or provider fallback.

## Tests

1. Domain: request scope, independent before/after expectations, selected add/update/delete, unchanged originals, undo/redo, and duplicate/range/snapshot rejection.
2. Providers: schemas/prompts/model/usage for three HTTP providers and an actual mock CLI process; errors/cancellation. Authenticated inference remains separate.
3. API: pre-cancel, duplicate requests, concurrent-operation rejection, old-ID cancellation isolation, and disconnect with late response.
4. Both apps: selection, manual import, comparison/partial apply, undo/redo, save, and actual MP4 with cuts/captions/effects. Check timing/gain and preservation of unselected assets/captions/deletions.
5. Regression: settings/correction, manual effects, media/caption rendering, final browser build and Mac package.

Passing establishes contracts and product behavior. Real proposal quality, natural effect placement, long-project performance, and human editing time remain separate evaluations.
