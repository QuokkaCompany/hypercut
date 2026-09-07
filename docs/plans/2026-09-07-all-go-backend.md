# Complete Go backend implementation plan

1. Inventory existing HTTP, job, project, media and desktop contracts.
2. Port common validation, timeline/PCM, source inspection and frame-aligned media export to Go.
3. Port transcription, VAD, captions, effects and AI/MCP adapters with contract checks.
4. Replace the cloud bridge with in-process Go calls and implement durable Go workers.
5. Port local API/file-grant lifecycle and wire the desktop adapter to Go.
6. Remove production Node server launch dependencies, update container/build/notices and English operations docs.
7. Run behavioral, failure, browser, media and Node-free container acceptance before publishing the migration.

Existing JavaScript tests serve as external contract clients/reference oracles. Tests must distinguish mocks from real inference. The writing-plans skill is not installed; this plan follows the explicit autonomous implementation authorization.
