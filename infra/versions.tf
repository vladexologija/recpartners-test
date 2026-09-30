terraform {
  required_version = ">= 1.11"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.5"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.9"
    }
  }
  # The bucket comes from `make bootstrap` (-backend-config), so this file names no project.
  backend "gcs" {
    prefix = "hotdog"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "this" {}

locals {
  # Cloud Run's deterministic URLs, known before the services exist. The bucket's CORS and the
  # push subscriptions use them, so neither has to wait for (or cycle with) the services.
  web_url    = "https://hotdog-web-${data.google_project.this.number}.${var.region}.run.app"
  worker_url = "https://hotdog-worker-${data.google_project.this.number}.${var.region}.run.app"

  # Until `make release` has written both image digests, only the foundation is created.
  released = var.web_image != "" && var.worker_image != ""
}
