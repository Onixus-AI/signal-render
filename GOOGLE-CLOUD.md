# Signal renderer on Google Cloud

The renderer remains the existing FFmpeg/Chromium service. Google mode adds
Cloud Tasks for accepted video requests and a private Cloud Storage bucket for
attempt leases and terminal callback receipts. It does not call image/video
model providers, publish posts, or bypass Signal's production reviews.

## Reviewable deployment

`deploy-google.sh` targets **onixus-signal / us-central1** and creates:

- `onixus-signal-render`: Cloud Run, 2 vCPU, 4 GiB, zero minimum instances,
  two maximum instances, request billing, 30-minute request timeout.
- `signal-video-renders`: one concurrent render task; ten attempts maximum,
  24-hour retry window. Each attempt has a deterministic task name.
- `onixus-signal-render-receipts`: private bucket with public-access prevention.
  Receipts are retained until an explicit retention policy is approved.
- Dedicated runtime identity with enqueue access to that queue, object access
  only in that bucket, and read access to only two renderer secrets.
- A `signal-render` Artifact Registry repository and one image build.

Required Secret Manager entries are `signal-render-token` and
`signal-render-html-token`. Never put values in git, command arguments, logs,
or chat. The first token must match Signal's Supabase `RENDER_TOKEN` at cutover.
Do not copy the Supabase service-role key or the Hermes/OpenRouter credentials.

The script initially deploys **private ingress**. Before exposing the HTTPS
service to Signal and Cloud Tasks, verify the real image's authenticated health
and obtain approval for the invoker policy change. Every render endpoint uses
application authentication; HTML authentication is required at startup in
Google mode. Do not switch Signal's URL until the deployed worker passes checks.

## Delivery and recovery

`/render-video` validates the existing payload and returns 202 only after Cloud
Tasks accepts it. `/tasks/render-video` keeps its request open until processing
and callback delivery finish, allowing request-billed CPU and scale-to-zero.
Cloud Storage generation preconditions prevent two task deliveries acquiring
the same attempt. A 35-minute lease outlives the 29-minute process deadline;
after a crash the task can retry once that lease expires. A different payload
cannot reuse an attempt token.

Terminal receipts are persisted before callback delivery. A callback outage or
container replacement replays the saved receipt without rendering again. A
crash before the receipt was stored can require another render, so exactly-once
compute is not promised. The existing coordinator's attempt fencing remains
required. Expired signed asset URLs must be reconciled with a fresh coordinator
attempt; do not generate another paid asset automatically.

Cloud mode deliberately rejects the old in-memory `/adapt-ad` path until that
path is moved into the durable queue. Master video rendering is supported;
do not present all platform variants as ready yet.

## Acceptance checks before cutover

1. Run the worker suite and build the real image with FFmpeg and Chromium.
2. Verify health: video_render, callback_protocol=2, status_endpoint_configured,
   html_render_auth_required, google_cloud_tasks and both durable flags.
3. Send an authorized test render with approved assets and required audio.
4. Interrupt a task and verify retry; simulate unavailable callback delivery
   and verify a new instance delivers the stored receipt without rerendering.
5. Confirm Signal receives the MP4, thumbnail, audio stream and final status.
6. Resume the existing Onyx pilot's reviews. Deployment is not publication.

Google usage charges still apply for builds, rendering, requests and storage;
zero minimum instances is not a guarantee of zero cost. The pilot's model/API
budget does not include infrastructure charges.

Official platform references:
- https://docs.cloud.google.com/run/docs/configuring/billing-settings
- https://docs.cloud.google.com/run/docs/triggering/using-tasks
- https://cloud.google.com/run/pricing
