# Postgres, the source of truth (D12). The smallest shared-core instance; only the Cloud SQL
# connector can reach it: a public IP with no authorized networks, and client certificates required.

resource "google_sql_database_instance" "db" {
  name                = "hotdog-pg"
  database_version    = "POSTGRES_17"
  region              = var.region
  deletion_protection = var.protect_db

  settings {
    edition           = "ENTERPRISE"
    tier              = "db-f1-micro"
    availability_type = "ZONAL"
    disk_size         = 10

    ip_configuration {
      ipv4_enabled = true
      ssl_mode     = "TRUSTED_CLIENT_CERTIFICATE_REQUIRED"
    }

    backup_configuration {
      enabled = false
    }

    maintenance_window {
      day  = 7 # Sunday
      hour = 3
    }

    # A request that hangs inside a transaction cannot hold its locks for long. (Cloud SQL does
    # not accept statement_timeout as an instance flag.)
    database_flags {
      name  = "idle_in_transaction_session_timeout"
      value = "60000"
    }
  }
}

resource "google_sql_database" "hotdog" {
  name     = "hotdog"
  instance = google_sql_database_instance.db.name
}

# A plain random_password (D10): it is kept in the private, versioned state bucket.
resource "random_password" "db" {
  length  = 32
  special = false # it goes into a URL unescaped
}

resource "google_sql_user" "hotdog" {
  name     = "hotdog"
  instance = google_sql_database_instance.db.name
  password = random_password.db.result
}

# The API reads one setting, HOTDOG_DATABASE_URL, so the whole URL is the secret. Cloud Run
# connects through the Cloud SQL volume's Unix socket.
resource "google_secret_manager_secret" "database_url" {
  secret_id = "database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret = google_secret_manager_secret.database_url.id
  secret_data = join("", [
    "postgresql+psycopg://${google_sql_user.hotdog.name}:${random_password.db.result}",
    "@/${google_sql_database.hotdog.name}",
    "?host=/cloudsql/${google_sql_database_instance.db.connection_name}",
  ])
}
