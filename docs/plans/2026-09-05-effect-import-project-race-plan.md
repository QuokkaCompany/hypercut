# Effect import versus project-file reads

Prepare projects A/B using the same source with different settings, cuts, captions, glossary, and effects. Hold B's file-read response, then start adding/reconnecting an effect in A. That newer action must invalidate the older read. Explicitly selecting B again must still work.

| Case | Controlled order | Expected result |
| --- | --- | --- |
| READ_DURING_IMPORT | Hold B read; start adding C to A; release B; complete C | Preserve A plus C, without mixing B settings |
| READ_AFTER_IMPORT | Hold B; finish C; release B | Preserve completed effect edit |
| READ_DURING_RECONNECT | Hold B; start reconnecting A asset; release B; finish reconnect | Preserve A and selected asset identity |
| CANCEL_THEN_OPEN | Hold B; start/cancel C import; select B again; release old responses | Preserve latest B; never add canceled C |

Run in Chrome and packaged Mac. Chrome holds upload delivery, forwards the selected bytes as multipart to the actual server, and returns its real response; this relay controls ordering and does not validate browser multipart serialization itself. Mac holds the native selection response and supplies a generated file or cancellation. Media inspection and project writes use product paths; native dialog operation is not covered.

Preserve intermediate UI and final projects. Check undo/redo and real mixed preview after successful addition. Reopen B and compare every field; hash-check three source assets and the video. If needed, include effect import start in the same operation sequence that invalidates older project reads. Preserve retry after cancellation/errors and never force disabled actions.
