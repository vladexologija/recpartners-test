output "url" {
  description = "The app"
  value       = local.web_url
}

output "worker_url" {
  value = local.worker_url
}

output "bucket" {
  value = google_storage_bucket.uploads.name
}

output "images" {
  description = "Where make release pushes"
  value       = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.images.repository_id}"
}
