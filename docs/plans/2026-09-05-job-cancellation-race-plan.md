# Canceled jobs versus subsequent edits

Follow-up to E06. New-media selection is disabled during work, but a completion response can clear the job before a pending cancellation returns. Test reachable orders without forcing disabled buttons.

| Case | Order | Expected result |
| --- | --- | --- |
| POST_LATE | Cancel before POST delivery; open B/start work; deliver old POST | Server pre-cancel record cancels old job; preserve B |
| POLL_LATE_ANALYZE | Hold real A completion; cancel; open B/start work; release A | No A cuts/progress/messages in B |
| POLL_LATE_EXPORT | Same order for export completion | No A result path/save button in B |
| CANCEL_LATE_SUCCESS | Hold cancellation separately; accept completion; open B/start work; release cancel success | Preserve B work and edits |
| CANCEL_LATE_ERROR | Same order with old cancel response changed to 503 | Do not show A's error in B |
| CANCEL_AFTER_EDIT | Complete work; edit current project; release old cancellation error | Preserve later edit/dirty state; suppress obsolete error |
| CURRENT_CANCEL_ERROR | Receive current cancellation error; cancel again | Show valid error and allow retry |

Run each in Chrome and the current Mac package with generated distinct sources and projects containing captions, glossary, and manual cuts. Completion payloads come from real jobs; only delivery order and injected 503s are controlled. Native paths are test-supplied, with OS dialogs covered separately.

Hold B's next preview while releasing old responses. Check progress, source, settings, cuts, and dirty state; then really render B, compare the complete saved project and both source hashes. Do not report an aborted HTTP response as delivered.

If needed, bind cancellation success/failure to current job identity while retaining current-error visibility. Preserve pre-fix failures and rerun the same orders plus recovery/project-I/O/transcription regressions. This does not cover every model/effect/OS-error combination or real recording quality.
