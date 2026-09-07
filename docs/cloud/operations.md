# Operating the single-host beta

Use one API process and a worker on a dedicated host or the supplied container configuration. Do not place the SQLite WAL database on NFS or run multiple API replicas: upload locks and per-session AI adapters are process-local. The default worker executes one job at a time, and the queue allows at most four active jobs per account.

## Public HTTPS

Set `HYPERCUT_PUBLIC_URL` to the exact HTTPS origin before starting. Put a TLS reverse proxy on the same host in front of the loopback-published API port. Preserve the original `Host` header. The API validates it against the configured origin and does not trust forwarding headers for authentication or client IP identity.

Example Caddy configuration for an operator-owned domain:

```caddyfile
edit.example.com {
    reverse_proxy 127.0.0.1:4328
}
```

A public domain, DNS, TLS certificate issuance and hosting are operator responsibilities; this repository does not create them. Configure proxy upload/time limits for 8 MiB chunks and longer upload finalization. Restrict external access to the intended beta users. The API uses HttpOnly SameSite cookies, Secure cookies on HTTPS, CSRF headers on mutations, origin checks and ownership-scoped file reads. It has a coarse sign-in rate limiter; behind a proxy, all users share the proxy's direct socket limit.

## Capacity and limits

Defaults: 2 GiB per video, 10 GiB accounted storage per account, eight incomplete uploads, 100 projects, 500 job records, four queued/running jobs per account. Dismiss old terminal jobs to free record capacity. Cloud video input is capped at two hours, 4K pixel count, 120 fps, 32 audio tracks and eight channels per track. Effects are capped at five minutes and 1 GiB by the shared engine.

Account storage accounting includes source assets, incomplete-upload reservations, completed outputs and pending output reservations. Output jobs reserve the larger of 32 MiB or three times the compressed source size. A completed output exceeding the remaining quota fails rather than being published.

**This is accounting, not a hard filesystem quota.** Temporary assembled uploads coexist with chunks; decoding, rendering, transcription and playback caches use additional disk space. Metadata is also outside byte accounting. Provision headroom, monitor actual volume usage and CPU/memory, and use a bounded dedicated volume. The default Compose containers have memory/CPU/process limits and run without root privileges or extra capabilities. Resource limits do not establish a full sandbox for hostile native-media exploits; public anonymous uploads are outside this beta's tested scope.

## Health and troubleshooting

```sh
docker compose ps
docker compose logs --tail=100 api worker
curl --fail http://127.0.0.1:4328/api/health
```

The Go health check verifies the API/database and that its private media helper has not exited. It does not establish worker readiness or transcription quality. Restart the API if the helper has exited; existing jobs continue in the independent worker. Jobs remaining queued usually mean the worker is stopped or occupied. Missing Whisper files disable new transcription while silence editing and existing captions still work. Session expiry requires sign-in again; it does not discard jobs or projects. A 409 save/apply response means another revision exists: reopen the project and review it.

Running jobs heartbeat every 500 ms by default, with a 15-second lease. A replacement worker marks expired work interrupted. The default job execution timeout is two hours. Existing FFmpeg cancellation sends termination and escalates if needed. Do not delete an active job directory by hand.

## Backup, cleanup and recovery

1. Stop API and worker to obtain a consistent offline backup.
2. Back up the entire persistent data directory/volume, including SQLite files, uploads and job outputs. Protect backups like original media and password hashes.
3. Restore the complete backup onto a host running the same commit, with the same ownership and environment settings.
4. Start API and worker; verify sign-in, project opening and a downloaded output before relying on the restored service.

Portable project JSON alone does not back up original media. Database-only backups do not back up source files. Backup/restore across different schema versions requires a migration plan; the beta currently initializes schema version 1.

Use workspace/API deletion for owned data. Complete export records can be deleted independently. Incomplete uploads retain their reservations until discarded. Shutdown does not delete user media. After stopping both processes, playback caches under `playback/` can be removed and regenerated. A crash during file deletion or upload finalization can leave harmless unused files; filesystem garbage collection and automated retention are future work. Do not run volume-wide cleanup while either process is active.

Account provisioning currently creates accounts only. Password reset, user removal, invitation email, registration, billing and audit-log administration are not implemented.
