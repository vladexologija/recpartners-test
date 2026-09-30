# Pub/Sub for every hop (D3): uploads → web, jobs → worker, worker events → web.
# All three subscriptions push, never expire, and keep messages for the default 7 days.

resource "google_pubsub_topic" "uploads" {
  name = "uploads"
}

resource "google_pubsub_topic" "jobs" {
  name = "analysis-jobs"
}

resource "google_pubsub_topic" "events" {
  name = "analysis-events"
}

# Web's push endpoints are not authenticated (D3, settled 2026-09-29).
resource "google_pubsub_subscription" "uploads_web" {
  name                 = "uploads-web"
  topic                = google_pubsub_topic.uploads.id
  ack_deadline_seconds = 60
  push_config {
    push_endpoint = "${local.web_url}/internal/gcs-events"
  }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  expiration_policy {
    ttl = ""
  }
}

# The worker is private: Cloud Run checks this token, and that pubsub-push may invoke it.
resource "google_pubsub_subscription" "jobs_worker" {
  name                 = "analysis-jobs-worker"
  topic                = google_pubsub_topic.jobs.id
  ack_deadline_seconds = 600 # push's maximum; it is also the request timeout (D3, D15)
  push_config {
    push_endpoint = "${local.worker_url}/internal/process"
    oidc_token {
      service_account_email = google_service_account.pubsub_push.email
      audience              = local.worker_url
    }
  }
  retry_policy {
    minimum_backoff = "30s"
    maximum_backoff = "600s"
  }
  expiration_policy {
    ttl = ""
  }
}

resource "google_pubsub_subscription" "events_web" {
  name                 = "analysis-events-web"
  topic                = google_pubsub_topic.events.id
  ack_deadline_seconds = 60
  push_config {
    push_endpoint = "${local.web_url}/internal/analysis-events"
  }
  retry_policy {
    minimum_backoff = "10s"
    maximum_backoff = "600s"
  }
  expiration_policy {
    ttl = ""
  }
}
