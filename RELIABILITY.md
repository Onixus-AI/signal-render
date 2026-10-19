# Worker recovery and operating limits

Mount a persistent Railway volume at `/data` (1 GiB is sufficient for the bounded journal). Railway supplies `RAILWAY_VOLUME_MOUNT_PATH`; `RENDER_STATE_DIR` can override it. Keep one replica attached to this volume. Without a volume the legacy in-memory mode remains available, and `/health` reports both durable flags as false.

Video requests are saved and fsynced before HTTP 202. Restart restores queued/interrupted renders. Completed output and failed render callbacks are persisted before delivery; a 30-second outbox loop retries until the coordinator acknowledges them. Attempt tokens fence retries, terminal duplicates do not rerender, pending callbacks never expire, and acknowledged terminal receipts are retained for seven days. Local files have owner-only permissions. An expired signed upload URL fails normally and requires a coordinator retry with fresh URLs; no provider purchase is repeated by this worker.

Limits: 50 pending video jobs (including pending completion delivery), 60 scenes, 10 minutes per video, 120 MiB per asset, 500 MiB total downloaded assets, 20 waiting browser renders, 16 million output pixels. Existing network and encode timeouts remain. Persistent write failure rejects acceptance with 503; corrupted state stops startup rather than discarding evidence. Monitor `journal_errors`, `undelivered_video_callbacks`, `durable_video_jobs` and `durable_callback_outbox`.

This is a single-worker persistent video queue/outbox, not a distributed queue. Ad adaptations still use their separate in-memory path. Browser rendering still needs infrastructure-level isolation and egress controls before broad untrusted multi-tenant use. A persistent volume protects container replacement, not volume deletion; backups and operational reconciliation remain necessary.

Validation includes real worker kill/restart, outbox delivery without rerendering, disk failure, concurrent deduplication, stale attempt rejection, queue and download bounds, and the existing real FFmpeg export suite. No paid provider calls are used by the tests.
