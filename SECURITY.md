# Security policy

HyperCut is in early development. Security fixes are currently made on the default branch; older snapshots do not have a separate security-maintenance commitment.

## Reporting a vulnerability

Use [GitHub private vulnerability reporting](https://github.com/QuokkaCompany/hypercut/security/advisories/new) to report a suspected vulnerability. Include the affected commit/version, platform, reproduction steps using synthetic data, expected and actual behavior, and impact. Redact tokens, keys, personal paths, and private media. Do not put an exploit containing private information in a public issue.

If private reporting is unavailable, open a public issue asking maintainers for a private reporting channel without including vulnerability details. No response-time or bounty commitment is currently offered.

## Relevant boundaries

The editor runs a local server and handles media files, project documents, native subprocesses, and optional AI connections. Reports involving local API authentication, path handling, subprocess execution, project parsing, stale permissions, credential exposure, and unintended outbound data are especially useful.

Optional AI requests can disclose the text and settings selected for the request to the chosen provider. Model files, dependencies, FFmpeg, and local AI tools have their own update and security requirements. Do not expose the local editor server to the public internet or publish a live MCP share key in an issue.
