# The Cloud Run resources (D3, D5, D7, D11). They exist once `make release` has written both
# image digests; before that, `make infra` creates the foundation alone.

locals {
  shared_env = {
    HOTDOG_PROJECT_ID = var.project_id
    HOTDOG_BUCKET     = google_storage_bucket.uploads.name
  }
}

# Migrations run before new code. Each release runs this job once with the new web image, the
# apply waits for it to succeed, and only then do the services roll (they depend on it). So a
# migration must also work with the previous code: add, never remove, in one release.
resource "google_cloud_run_v2_job" "migrate" {
  count               = local.released ? 1 : 0
  name                = "hotdog-migrate"
  location            = var.region
  deletion_protection = false
  run_execution_token = substr(sha256(var.web_image), 0, 12)

  template {
    template {
      service_account = google_service_account.web.email
      max_retries     = 0
      containers {
        image   = var.web_image
        command = ["alembic", "upgrade", "head"]
        dynamic "env" {
          for_each = local.shared_env
          content {
            name  = env.key
            value = env.value
          }
        }
        env {
          name = "HOTDOG_DATABASE_URL"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.database_url.secret_id
              version = google_secret_manager_secret_version.database_url.version
            }
          }
        }
        volume_mounts {
          name       = "cloudsql"
          mount_path = "/cloudsql"
        }
      }
      volumes {
        name = "cloudsql"
        cloud_sql_instance {
          instances = [google_sql_database_instance.db.connection_name]
        }
      }
    }
  }

  depends_on = [
    google_project_iam_member.web_sql,
    google_secret_manager_secret_iam_member.web_database_url,
  ]
}

resource "google_cloud_run_v2_service" "web" {
  count                = local.released ? 1 : 0
  name                 = "hotdog-web"
  location             = var.region
  deletion_protection  = false
  invoker_iam_disabled = true # public, without an allUsers grant (the organization forbids those)

  template {
    service_account = google_service_account.web.email
    # One instance (D7): an event and the streams it wakes must meet in the same process.
    scaling {
      min_instance_count = 0
      max_instance_count = 1
    }
    containers {
      image = var.web_image
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = local.shared_env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name = "HOTDOG_DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = google_secret_manager_secret_version.database_url.version
          }
        }
      }
      volume_mounts {
        name       = "cloudsql"
        mount_path = "/cloudsql"
      }
    }
    volumes {
      name = "cloudsql"
      cloud_sql_instance {
        instances = [google_sql_database_instance.db.connection_name]
      }
    }
  }

  depends_on = [
    google_cloud_run_v2_job.migrate,
    google_storage_bucket_iam_member.web_objects,
    google_service_account_iam_member.web_signs_as_itself,
    google_pubsub_topic_iam_member.web_publishes_jobs,
  ]
}

resource "google_cloud_run_v2_service" "worker" {
  count               = local.released ? 1 : 0
  name                = "hotdog-worker"
  location            = var.region
  deletion_protection = false

  template {
    service_account                  = google_service_account.worker.email
    max_instance_request_concurrency = 1 # one video per instance (D5)
    timeout                          = "600s"
    execution_environment            = "EXECUTION_ENVIRONMENT_GEN2"
    scaling {
      min_instance_count = var.worker_min_instances
      max_instance_count = var.worker_max_instances
    }
    containers {
      image = var.worker_image
      resources {
        limits = {
          cpu    = var.worker_cpu
          memory = var.worker_memory
        }
        cpu_idle          = true
        startup_cpu_boost = true
      }
      dynamic "env" {
        for_each = local.shared_env
        content {
          name  = env.key
          value = env.value
        }
      }
      env {
        name  = "HOTDOG_TORCH_THREADS" # applied after ultralytics resets it (D4)
        value = var.worker_cpu
      }
    }
  }

  depends_on = [
    google_storage_bucket_iam_member.worker_reads,
    google_pubsub_topic_iam_member.worker_publishes_events,
  ]
}
