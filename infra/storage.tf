# The uploads bucket (D9). Browsers PUT straight into it with signed URLs, and every finished
# upload under videos/ becomes a message on the `uploads` topic (D3).

resource "google_storage_bucket" "uploads" {
  name                        = "${var.project_id}-uploads"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = false

  cors {
    origin = concat([local.web_url], var.extra_cors_origins)
    method = ["PUT", "GET", "HEAD"]
    # The headers the signed PUT makes the browser send (app/gcp/storage.py).
    response_header = ["Content-Type", "x-goog-content-length-range", "x-goog-if-generation-match"]
    max_age_seconds = 3600
  }

  lifecycle_rule {
    condition {
      age = 60
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_notification" "uploads" {
  bucket             = google_storage_bucket.uploads.name
  topic              = google_pubsub_topic.uploads.id
  payload_format     = "JSON_API_V1"
  event_types        = ["OBJECT_FINALIZE"]
  object_name_prefix = "videos/"
  depends_on         = [google_pubsub_topic_iam_member.gcs_publishes_uploads]
}

# Cloud Storage publishes the notifications as its own service agent.
data "google_storage_project_service_account" "gcs" {}

resource "google_pubsub_topic_iam_member" "gcs_publishes_uploads" {
  topic  = google_pubsub_topic.uploads.id
  role   = "roles/pubsub.publisher"
  member = "serviceAccount:${data.google_storage_project_service_account.gcs.email_address}"
}
