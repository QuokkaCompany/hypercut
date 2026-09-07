# Self-hosted cloud beta

HyperCut has two independent entry points that share the editing engine:

| Edition | Start command | Processing and persistence |
| --- | --- | --- |
| Local browser / desktop | `npm start` / `npm run desktop` | Loopback server; no login; media stays on your computer; portable project files |
| Cloud beta | `npm run cloud:api` and `npm run cloud:worker` | Authenticated browser; uploaded media, versioned projects and durable jobs on your host |

The cloud beta is intended for an operator-managed group on one host. It includes upload, editing and export without installing software on each user's computer. It does not provision a public hosting account or include registration, billing, email recovery, GPU scheduling or multiple API replicas.

## Start with Docker Compose

Install Docker with Compose, clone this repository, and run:

```sh
cp .env.example .env
docker compose up --build -d
```

The default address is `http://127.0.0.1:4328`. The image includes FFmpeg, Silero VAD, caption fonts, and the pinned multilingual Whisper small model. The first build downloads dependencies, builds whisper.cpp and downloads approximately 488 MB of model data. Model and source downloads are hash verified. Set `WITH_TRANSCRIPTION=0` before building if you only need silence editing and existing captions.

Create an account without placing its password in command history or process arguments:

```sh
python3 -c 'import getpass; print(getpass.getpass("New password: "))' \
  | docker compose exec -T api node scripts/cloud-user.mjs editor@example.com
```

Use a real operator-chosen email identifier and a password of 12–256 characters. No email is sent. Sign in, select **New edit**, and upload H.264 SDR MP4/MOV media. Select an audio track and analyze silence, review cuts, then export. Jobs continue when the submitting browser tab closes.

The worker processes one job at a time. API and worker use the same persistent `cloud-data` volume. `docker compose down` preserves it; **`docker compose down -v` deletes it**. Back up required projects and media before deleting volumes.

## Run directly for development

Cloud requires **Node.js 24 or newer**; the local edition retains its existing Node requirement. [Node's SQLite API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) is experimental in Node 24. SQLite operations here are synchronous, short metadata transactions.

```sh
npm ci
npm run build
python3 -c 'import getpass; print(getpass.getpass("New password: "))' \
  | npm run cloud:user -- editor@example.com
npm run cloud:api
# In another terminal, with the same environment:
npm run cloud:worker
```

FFmpeg/ffprobe must be installed. Optional `npm run setup:transcription` supports Apple Silicon macOS and Linux arm64/x64. Linux requires CMake and a C++ toolchain (`apt-get install cmake build-essential python3`). Desktop packaging remains a separate macOS workflow.

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `HYPERCUT_PUBLIC_URL` | `http://127.0.0.1:4328` | Exact browser origin; HTTPS required outside loopback |
| `PORT` | `4328` | API listen port |
| `HYPERCUT_CLOUD_HOST` | `127.0.0.1` | Bind address; container image uses `0.0.0.0` inside its network |
| `HYPERCUT_CLOUD_DATA` | `.hypercut/cloud` | Shared SQLite and file directory; set the same absolute path for API, worker and account CLI |
| `HYPERCUT_CLOUD_QUOTA_BYTES` | 10 GiB | Per-account upload/output accounting; set identically for API and worker |
| `HYPERCUT_CLOUD_MAX_UPLOAD_BYTES` | 2 GiB | Per-file limit |
| `HYPERCUT_TRANSCRIPTION_DIR` | `.hypercut/transcription` | Prepared runtime/model; container uses `/opt/hypercut/transcription` |

Node commands inherit environment variables from the shell; they do not automatically read `.env`. Compose reads `.env` for interpolation. Do not expose the local edition's port 4327 as a cloud service.

## Browser workflow and recovery

- **Save project** stores the current edit on the server. Edits are not saved on every keystroke. Each processing job first saves its input snapshot.
- **Download project** exports the portable v8 JSON for local use. Keep source and effect files as well. Existing v1–v7 imports still migrate through the shared validator.
- After reconnecting, the workspace lists projects, processing jobs, outputs and source media. Select **Apply & open** for a completed analysis/transcription whose base revision still matches. Newer edits are preserved when versions differ.
- If a worker stops, its lease expires and its active job becomes interrupted/failed. Open the project and submit a new job to retry. HyperCut does not silently repeat work.
- Cancelling an upload pauses it. Select the same file again to resume; the browser verifies all retained chunks before appending. The workspace can discard incomplete uploads.
- Delete unused exports and projects in the workspace. Source deletion is refused while a project or active job refers to it. Deleting a project keeps its source file.
- Uploaded effect files are account-owned. The API exposes their list/deletion endpoints; project effect assets reconnect automatically within the same cloud account.

## Optional AI

Cloud supports manual JSON exchange and user-supplied OpenAI/Anthropic API credentials. Connections are scoped to a login session, kept in memory and discarded on disconnect, logout, expiry cleanup or API restart. Saving a connection does not invoke a model. Only explicit proposal requests send the selected text/settings to the chosen provider.

The operator's Ollama, Claude CLI login and local MCP bridge are unavailable to cloud users. Those remain features of the independent local edition. Paid API inference is not part of the cloud acceptance tests.

See [operations](operations.md), [architecture](architecture.md), [API contract](api.md) and the [implementation plan](../plans/2026-09-07-cloud-beta.md).

Executed checks and platform limits are recorded in [cloud beta validation](../testing/2026-09-07-cloud-beta-results.md).
