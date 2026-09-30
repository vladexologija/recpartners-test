# One service account per job, each with only what it uses (Part 1 §4, D3).

resource "google_service_account" "web" {
  account_id   = "hotdog-web"
  display_name = "Web: the API, the app and the event handlers"
}

resource "google_service_account" "worker" {
  account_id   = "hotdog-worker"
  display_name = "Worker: reads uploads, publishes analysis events"
}

resource "google_service_account" "pubsub_push" {
  account_id   = "pubsub-push"
  display_name = "Signs Pub/Sub's pushes to the worker"
}

# Web signs the upload and playback URLs, so it needs what they allow (create, get), and it
# deletes rejected uploads. It signs without a key, through the IAM API, as itself.
resource "google_storage_bucket_iam_member" "web_objects" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectUser"
  member = google_service_account.web.member
}

resource "google_service_account_iam_member" "web_signs_as_itself" {
  service_account_id = google_service_account.web.name
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = google_service_account.web.member
}

resource "google_project_iam_member" "web_sql" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = google_service_account.web.member
}

resource "google_secret_manager_secret_iam_member" "web_database_url" {
  secret_id = google_secret_manager_secret.database_url.id
  role      = "roles/secretmanager.secretAccessor"
  member    = google_service_account.web.member
}

resource "google_pubsub_topic_iam_member" "web_publishes_jobs" {
  topic  = google_pubsub_topic.jobs.id
  role   = "roles/pubsub.publisher"
  member = google_service_account.web.member
}

# The worker reads uploads and publishes its events. It has no database access (D3).
resource "google_storage_bucket_iam_member" "worker_reads" {
  bucket = google_storage_bucket.uploads.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.worker.member
}

resource "google_pubsub_topic_iam_member" "worker_publishes_events" {
  topic  = google_pubsub_topic.events.id
  role   = "roles/pubsub.publisher"
  member = google_service_account.worker.member
}

# The worker is private: only Pub/Sub's pushes, signed as pubsub-push, may invoke it.
resource "google_cloud_run_v2_service_iam_member" "push_invokes_worker" {
  count    = local.released ? 1 : 0
  name     = google_cloud_run_v2_service.worker[0].name
  location = var.region
  role     = "roles/run.invoker"
  member   = google_service_account.pubsub_push.member
}
