.PHONY: sync model db api-types check check-api check-worker check-web check-contract \
	bootstrap infra plan release pause destroy

# Install every project's dependencies (a fresh clone, or after a pull)
sync: model
	cd api && uv sync
	cd worker && uv sync
	cd web && pnpm install

# The detector's weights (D4) are downloaded, not committed, and checked against the SHA-256
# that GitHub publishes for the release asset. Skips the download when the file is already right.
MODEL_URL = https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.pt

model:
	cd worker/models && (shasum -a 256 --status -c yolo26n.pt.sha256 2>/dev/null || \
		(curl -fL -o yolo26n.pt $(MODEL_URL) && shasum -a 256 -c yolo26n.pt.sha256))

# Local Postgres 17 for development (api/.env.example), on port 5433 because 5432 is often
# taken by a native install. Starts it if needed, waits for it, and applies the migrations.
db:
	docker start hotdog-db 2>/dev/null || docker run -d --name hotdog-db -p 5433:5432 \
		-e POSTGRES_USER=hotdog -e POSTGRES_PASSWORD=hotdog -e POSTGRES_DB=hotdog \
		-v hotdog-db:/var/lib/postgresql/data postgres:17
	until docker exec hotdog-db pg_isready -q -h 127.0.0.1 -U hotdog; do sleep 1; done
	cd api && uv run alembic upgrade head

# The frontend's API types come from FastAPI (D10): export the OpenAPI schema, then generate
# TypeScript from it. Run after changing a route or an API model; commit both files.
OPENAPI_EXPORT = uv run python -c "import json; from app.main import app; print(json.dumps(app.openapi(), indent=2))"

api-types:
	cd api && $(OPENAPI_EXPORT) > ../web/openapi.json
	cd web && pnpm generate:api

# Everything must pass before a commit or a release
check: check-api check-worker check-web check-contract

check-api:
	cd api && uv lock --check && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest

check-worker:
	cd worker && uv lock --check && uv run ruff format --check . && uv run ruff check . && uv run mypy && uv run pytest

check-web:
	cd web && pnpm typecheck && pnpm test

# Fails when api/ changed without `make api-types`: the committed schema and types must match.
check-contract:
	cd api && $(OPENAPI_EXPORT) | diff -u ../web/openapi.json - || (echo 'OpenAPI schema is stale: run make api-types' && exit 1)

# --- Deploy (docs/design.md Part 1 §6, with Part 0's two images) -------------------------------
# infra/terraform.tfvars (copied from terraform.tfvars.example) names the project and the region.
tfvar = $(shell sed -n 's/^$(1) *= *"\(.*\)"/\1/p' infra/terraform.tfvars 2>/dev/null)
PROJECT = $(call tfvar,project_id)
REGION = $(call tfvar,region)
REPO = $(REGION)-docker.pkg.dev/$(PROJECT)/hotdog
TF = terraform -chdir=infra

# One-time, outside Terraform: the APIs, the versioned state bucket, terraform init, and a budget
# alert for the project (alerts only: a budget does not cap spending). Safe to run again.
BILLING = $(shell gcloud billing projects describe $(PROJECT) --format='value(billingAccountName.basename())')
BUDGET = 50USD

bootstrap:
	gcloud services enable --project=$(PROJECT) run.googleapis.com sqladmin.googleapis.com \
		artifactregistry.googleapis.com cloudbuild.googleapis.com iamcredentials.googleapis.com \
		secretmanager.googleapis.com storage.googleapis.com pubsub.googleapis.com \
		billingbudgets.googleapis.com
	gcloud storage buckets describe gs://$(PROJECT)-tfstate >/dev/null 2>&1 || \
		gcloud storage buckets create gs://$(PROJECT)-tfstate --project=$(PROJECT) \
			--location=$(REGION) --uniform-bucket-level-access --public-access-prevention
	gcloud storage buckets update gs://$(PROJECT)-tfstate --versioning
	$(TF) init -backend-config=bucket=$(PROJECT)-tfstate
	gcloud billing budgets list --billing-account=$(BILLING) --billing-project=$(PROJECT) \
		--filter="displayName=$(PROJECT)" --format="value(name)" | grep -q . || \
		gcloud billing budgets create --billing-account=$(BILLING) --billing-project=$(PROJECT) \
			--display-name=$(PROJECT) --budget-amount=$(BUDGET) --filter-projects=projects/$(PROJECT) \
			--threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0

# Before the first release there are no images, so this creates everything but the services.
infra:
	$(TF) apply

plan:
	$(TF) plan

# Both images from a clean tree, tagged with the commit (tags are immutable, so an existing tag is
# not rebuilt). Terraform then deploys their digests, and the pointer is committed: the repo states
# what is live.
release:
	@test -z "$$(git status --porcelain)" || (echo "Commit first: releases are built from a clean tree" && exit 1)
	$(eval TAG := $(shell git rev-parse --short HEAD))
	gcloud artifacts docker images describe $(REPO)/worker:$(TAG) >/dev/null 2>&1 || \
		gcloud builds submit --project=$(PROJECT) --region=$(REGION) --config=infra/build.yaml \
			--substitutions=_REPO=$(REPO),_TAG=$(TAG) \
			--service-account=projects/$(PROJECT)/serviceAccounts/hotdog-build@$(PROJECT).iam.gserviceaccount.com \
			--gcs-source-staging-dir=gs://$(PROJECT)-build/source .
	printf 'web_image    = "%s"\nworker_image = "%s"\n' \
		"$$(gcloud artifacts docker images describe $(REPO)/web:$(TAG) --format='value(image_summary.fully_qualified_digest)')" \
		"$$(gcloud artifacts docker images describe $(REPO)/worker:$(TAG) --format='value(image_summary.fully_qualified_digest)')" \
		> infra/image.auto.tfvars
	$(TF) apply
	git commit -m "Release $(TAG)" infra/image.auto.tfvars

# After the review window: no warm worker (the default of 0 instead of terraform.tfvars' 1).
pause:
	$(TF) apply -var=worker_min_instances=0

# The database survives this until protect_db = false has been applied.
destroy:
	$(TF) destroy
