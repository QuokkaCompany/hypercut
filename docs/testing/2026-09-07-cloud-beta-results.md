# Local and self-hosted cloud beta validation

Date: 2026-09-07. Scope: the `codex/self-hosted-cloud-beta` implementation. This record covers functional behavior and failure recovery, not a public SaaS launch or human speech-quality certification.

## Results

| Check | Result | Evidence and scope |
| --- | --- | --- |
| TypeScript and production Vite build | PASS | `npm run build` |
| Existing unit suite | 97 PASS | `npm test` |
| Existing local API suite | 12 PASS | `npm run test:api`; authentication, cancellation, previews, AI mocks |
| Existing media suite | 8 PASS | `npm run test:media`; real FFmpeg fixtures |
| Cloud API/worker integration | 12 PASS | `npm run test:cloud`; disposable accounts and a separate worker process |
| Cloud browser acceptance | PASS | `npm run test:cloud:e2e`; actual Chrome, desktop/mobile layouts |
| Local browser and Electron acceptance | PASS | `npm run test:e2e -- --desktop`; real output decoding, test-controlled native dialog responses |
| Project I/O races | 8 PASS | `npm run test:project:io`; browser and Electron; newer edits and source files preserved |
| Job cancellation races | 34 PASS | `npm run test:jobs:races`; browser and Electron; late requests/responses and cancellation errors |
| Docker image and Compose startup | PASS | Linux arm64; non-root API and worker, shared volume, health check, FFmpeg and bundled Whisper |
| Real Linux CPU AI/media path | PASS | `node scripts/cloud-container-smoke.mjs`; authenticated upload, Silero, Whisper, TXT, caption preview and captioned MP4 |

The cloud integration suite checks cookie/CSRF/origin/host boundaries; owner isolation for media, projects, uploads, jobs, results and effects; chunk hashes, offsets, replay and API-restart resume; idempotent job submission; stale project revisions; queued persistence; cancellation before and during execution; forced worker death and explicit retry; full MP4 decoding and unchanged source hashes; session-scoped AI settings; quotas; playlist rejection; and persisted sound-effect mixing.

The browser scenario signs in, uploads media, analyzes five synthetic pauses, saves the project, downloads portable JSON, reloads and restores the project, edits it, starts export and closes the submitting tab. A new tab downloads and fully decodes the completed output. Desktop and mobile workspace/editor screenshots were inspected; no horizontal page overflow was observed at 390 px. Browser page errors were empty.

## Actual model exercise

The optional container smoke script uses macOS Samantha TTS solely to generate an English test fixture; the uploaded video is processed in the Linux container. Silero detected three speech intervals. Whisper returned two cues containing the expected test sentences. The worker produced a TXT transcript and a 9.367-second MP4 with two burned captions. Full FFmpeg decoding passed. No paid model requests were made.

This establishes that the prepared CPU model/runtime works through the cloud job path on the tested Linux arm64 container. It does not establish multilingual recognition quality, accuracy on human recordings, GPU support or Linux x64 Whisper performance.

## Reproduction and artifacts

Synthetic logs, screenshots, portable test projects and rendered media remain in ignored `test-output/`. The browser artifacts are under `test-output/cloud-e2e/`; the Linux captioned video and result JSON are under `test-output/cloud-container/`. Existing race harnesses retain their source fingerprints and per-scenario records in their own output directories. No personal media, real API credentials or production account data is included in this change.

For the optional model check, start a disposable Compose project named `hypercut-beta-validation`, then run the container smoke script on macOS. It creates a test account and synthetic files in that project's volume. Remove only that test-owned project/volume after retaining desired evidence. Ordinary cloud integration tests do not need Docker, TTS or model downloads.

## Limits

- No domain, public HTTPS endpoint, paid infrastructure, registry image, billing or user registration was provisioned.
- Account byte accounting excludes transient processing files, playback caches and metadata; it is not a hard disk quota.
- Backup/restore across schema versions, multi-host operation, automated garbage collection and hostile native-decoder sandboxing are unvalidated or unimplemented.
- Cloud runtime/API tests ran locally on macOS and in an arm64 Linux container. CI adds Node 24 Linux API/cloud/browser coverage; remote CI status must be read from the PR checks.
- Electron checks launched the source app and controlled dialog responses. They do not validate a freshly signed/notarized package, real Finder save dialogs or clean-machine installation.
- Existing human speech preservation, caption quality and editing-time-savings gates remain open.
