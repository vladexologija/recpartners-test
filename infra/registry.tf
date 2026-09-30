# Images and the account that builds them (`make release`, infra/build.yaml).

resource "google_artifact_registry_repository" "images" {
  repository_id = "hotdog"
  format        = "DOCKER"
  location      = var.region
  docker_config {
    immutable_tags = true # a tag is a commit: it never points at another image
  }
}

# Cloud Build runs as its own account: it reads the uploaded sources and pushes the images.
resource "google_service_account" "build" {
  account_id   = "hotdog-build"
  display_name = "Builds the images (make release)"
}

resource "google_storage_bucket" "build" {
  name                        = "${var.project_id}-build"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  force_destroy               = true # only uploaded sources
  lifecycle_rule {
    condition {
      age = 7
    }
    action {
      type = "Delete"
    }
  }
}

resource "google_storage_bucket_iam_member" "build_reads_sources" {
  bucket = google_storage_bucket.build.name
  role   = "roles/storage.objectViewer"
  member = google_service_account.build.member
}

resource "google_artifact_registry_repository_iam_member" "build_pushes" {
  repository = google_artifact_registry_repository.images.name
  location   = var.region
  role       = "roles/artifactregistry.writer"
  member     = google_service_account.build.member
}

resource "google_project_iam_member" "build_logs" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = google_service_account.build.member
}
