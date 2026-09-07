# Contributing to HyperCut

HyperCut is an early-stage, local-first video editor maintained under the QuokkaCompany organization. Contributions to editing reliability, accessibility, documentation, localization, and reproducible validation are welcome.

## Development setup

Development currently targets macOS on Apple Silicon. Install Node.js 22.12 or newer and FFmpeg/ffprobe, then clone your fork:

```sh
git clone https://github.com/YOUR_USERNAME/hypercut.git
cd hypercut
npm ci
npm run dev
```

Open `http://127.0.0.1:5173`. To run the production browser build or the desktop window:

```sh
npm run build
npm start
# Or launch the desktop app:
npm run desktop
```

Local transcription requires a separately prepared whisper.cpp runtime and model. Follow the [README](README.md) before running `npm run setup:transcription` or `npm run package:desktop`. Setup downloads a model of about 488 MB and uses Apple Silicon macOS build tools. FFmpeg is not bundled in the desktop package.

## Making a change

Open an issue for a substantial design change so the intended behavior and validation can be discussed. Small fixes can go directly to a pull request. Keep each pull request focused, explain the user-visible problem and result, and identify any remaining limitations.

Use English for documentation, issue descriptions, pull request descriptions, and new explanatory comments. The current application UI is Korean. Preserve intentional non-English text in localization data, media fixtures, and multilingual tests; changing that text can change the behavior under test.

Useful source directories:

| Directory | Responsibility |
| --- | --- |
| `src/` | React editor and browser UI |
| `shared/` | Timeline, project, caption, and proposal rules |
| `server/` | Shared job engine, local API, media processing, transcription, and AI adapters |
| `cmd/hypercut-cloud/`, `internal/cloud/` | Go cloud HTTP API, account/session handling, uploads, metadata and job submission |
| `server/cloud/` | Node media worker/private helper and original API for compatibility/rollback |
| `desktop/` | Electron lifecycle and native file integration |
| `scripts/` | Development, packaging, fixtures, and validation runners |
| `tests/` | Unit and integration tests |
| `docs/` | Plans, validation procedures, and dated evidence |

## Validation

Run the quick checks before submitting:

```sh
npm test
npm run build
```

For media changes, run `npm run test:media`. For API changes, run `npm run test:api`. Select additional tests appropriate to the behavior; see the [testing guide](docs/testing/README.md). Some suites require FFmpeg, a prepared model, macOS TTS, Chrome, or a freshly packaged Mac app. Do not run all long benchmarks merely to check a documentation edit.

Test actual retained media, timestamps, decoded output, and saved projects when those behaviors change. Use independent expectations, preserve failure records, and distinguish mock-provider tests from authenticated inference. Browser results do not establish native-package behavior. Use a new output directory for every evidence run and identify the exact code, bundle, model, and runner versions.

Do not commit private recordings, transcripts, reports, credentials, local models/runtimes, generated media, or personal machine paths. These belong in ignored local folders. Public fixtures must be synthetic or have clear redistribution permission. Review the staged diff before committing, even when `.gitignore` excludes common private paths.

## Pull requests and licensing

Describe what changed, why, how it was validated, and anything not tested. Link related issues and include screenshots when they clarify a UI change. Keep historical results tied to their original candidate instead of rewriting failed results as passes.

By contributing, you agree that your original contribution may be distributed under this repository's [GPL-3.0-only license](LICENSE). Preserve applicable third-party notices and identify the source and license of any new assets or dependencies. Follow the [community guidelines](CODE_OF_CONDUCT.md) and use the [security policy](SECURITY.md) for vulnerability reports.

The `private` field in `package.json` prevents accidental npm publication; it does not make the GitHub repository private.

## Cloud contributions

Read the [cloud architecture](docs/cloud/architecture.md) and [API contract](docs/cloud/api.md). Cloud transport changes must preserve offline local editing and portable project compatibility. Keep accounts and provider credentials outside project JSON. Use ownership-scoped queries for every file, job and project. Test stale revisions, interrupted requests and cross-account IDs, not only the successful path.

On Go 1.26+ and Node 24+ with FFmpeg, run `npm run test:server`, `npm run test:cloud:go` and, after building the frontend, `npm run test:cloud:go:e2e` (Chrome locally or Playwright Chromium in CI). These use disposable synthetic media and accounts, a real separate worker and downloaded-output decoding. The migration case also switches Node → Go → Node → Go while preserving sessions, partial uploads, projects and jobs. `npm run test:cloud` and `npm run test:cloud:e2e` retain the original Node transport checks. No paid inference is requested. Use the same storage directory and limits for API, worker and account CLI.

Format Go changes with `gofmt` and run `go vet ./...`. Keep media/project validation in the shared engine rather than copying timeline rules into Go. Regenerate bundled module notices with `node scripts/go-notices.mjs` when Go dependencies change. The Go transport currently targets macOS and Linux; local/Electron development does not require Go.
