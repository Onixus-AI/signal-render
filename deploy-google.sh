#!/usr/bin/env bash
set -euo pipefail
# Run from the reviewed renderer checkout, after scoped IAM/secret approval.
# Secrets must already exist; this script never creates or prints credentials.
render_project=onixus-signal
render_region=us-central1
render_service=onixus-signal-render
render_account="${render_service}@${render_project}.iam.gserviceaccount.com"
render_bucket="${render_project}-render-receipts"
render_queue=signal-video-renders
render_image="${render_region}-docker.pkg.dev/${render_project}/signal-render/worker:$(git rev-parse --short=12 HEAD)"

for render_secret in signal-render-token signal-render-html-token; do
  gcloud secrets versions describe latest --secret="$render_secret" --project="$render_project" --format='value(state)' | grep -qx ENABLED
done
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com cloudtasks.googleapis.com storage.googleapis.com --project="$render_project"
gcloud iam service-accounts describe "$render_account" --project="$render_project" >/dev/null 2>&1 || \
  gcloud iam service-accounts create "$render_service" --display-name='Signal render worker only' --project="$render_project"
gcloud artifacts repositories describe signal-render --location="$render_region" --project="$render_project" >/dev/null 2>&1 || \
  gcloud artifacts repositories create signal-render --repository-format=docker --location="$render_region" --project="$render_project"
gcloud storage buckets describe "gs://${render_bucket}" --project="$render_project" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${render_bucket}" --location="$render_region" --uniform-bucket-level-access --public-access-prevention --project="$render_project"
gcloud storage buckets add-iam-policy-binding "gs://${render_bucket}" --member="serviceAccount:${render_account}" --role=roles/storage.objectUser
gcloud tasks queues describe "$render_queue" --location="$render_region" --project="$render_project" >/dev/null 2>&1 || \
  gcloud tasks queues create "$render_queue" --location="$render_region" --project="$render_project"
gcloud tasks queues update "$render_queue" --location="$render_region" --project="$render_project" --max-concurrent-dispatches=1 --max-dispatches-per-second=1 --max-attempts=10 --max-retry-duration=86400s --min-backoff=60s --max-backoff=3600s
gcloud tasks queues add-iam-policy-binding "$render_queue" --location="$render_region" --project="$render_project" --member="serviceAccount:${render_account}" --role=roles/cloudtasks.enqueuer
for render_secret in signal-render-token signal-render-html-token; do
  gcloud secrets add-iam-policy-binding "$render_secret" --project="$render_project" --member="serviceAccount:${render_account}" --role=roles/secretmanager.secretAccessor
done
gcloud builds submit . --project="$render_project" --tag="$render_image"
gcloud run deploy "$render_service" --project="$render_project" --region="$render_region" --image="$render_image" \
  --service-account="$render_account" --no-allow-unauthenticated \
  --cpu=2 --memory=4Gi --min-instances=0 --max-instances=2 --concurrency=8 --timeout=1800 \
  --set-secrets=RENDER_TOKEN=signal-render-token:latest,RENDER_HTML_TOKEN=signal-render-html-token:latest \
  --set-env-vars="GOOGLE_CLOUD_PROJECT=${render_project},RENDER_QUEUE_MODE=google-cloud-tasks,RENDER_QUEUE_LOCATION=${render_region},RENDER_QUEUE_NAME=${render_queue},RENDER_RECEIPTS_BUCKET=${render_bucket},RENDER_TASK_TARGET_URL=https://pending.invalid,SUPABASE_URL=https://rjwbfkuzgusaoizcmmgf.supabase.co,MAX_HTML_CONCURRENCY=1"
render_url=$(gcloud run services describe "$render_service" --project="$render_project" --region="$render_region" --format='value(status.url)')
gcloud run services update "$render_service" --project="$render_project" --region="$render_region" --update-env-vars="RENDER_TASK_TARGET_URL=${render_url}"
printf 'Private renderer deployed: %s\n' "$render_url"
printf '%s\n' 'Next: verify health with IAM authentication, then approve the app-authenticated ingress and update Signal endpoint/token together. No publishing is enabled by this script.'
