# hotdog-api

The web service, `hotdog-web` on Cloud Run: the FastAPI API, the React app it serves from `../web/dist`, and the handlers for Pub/Sub's pushes. Postgres is the source of truth. The service never handles video bytes; browsers upload straight to GCS with a signed URL.

## Run it locally

```bash
cp .env.example .env    # the database URL; set HOTDOG_PROJECT_ID and HOTDOG_BUCKET
make -C .. db           # Postgres 17 in Docker on port 5433, migrated
uv run fastapi dev      # http://localhost:8000, with the API's docs at /docs
```

Creating a video signs a GCS upload URL, so it needs Google credentials that can sign as a service account; everything else runs against the local database. To work on the frontend alone, `pnpm dev:mock` in `../web` needs no backend at all.

## Test

```bash
uv run pytest   # starts Postgres with testcontainers (Docker)
HOTDOG_TEST_DATABASE_URL=postgresql+psycopg://user@localhost:5434/test uv run pytest   # or an empty database of your own
```

`make -C .. check-api` also runs ruff and mypy.

## Change the database

Edit the tables in `app/models/`, then generate and apply a migration against the dev database:

```bash
uv run alembic revision --autogenerate -m "what changed"
uv run alembic upgrade head
```

A test fails when the models and the migrations drift apart. Releases run the migrations as a Cloud Run job before the new code rolls out, so a migration must also work with the previous code.

## Change the API

After changing a route or an API model, run `make -C .. api-types`: it regenerates `web/openapi.json` and the frontend's TypeScript types. `make check-contract` fails until you do.

## Settings

`HOTDOG_DATABASE_URL`, `HOTDOG_PROJECT_ID`, `HOTDOG_BUCKET` and `HOTDOG_JOBS_TOPIC` (default `analysis-jobs`), from the environment or `.env`.

## Layout

- `app/main.py`: the app. `app/api/` holds the routes and their dependencies, with the Pub/Sub push endpoints in `app/api/routes/internal.py`.
- `app/handlers.py`: what happens when an upload lands and when each worker event arrives.
- `app/crud.py`: every database read and write, including the status guards that make redelivery safe.
- `app/models/`: the tables. `app/schemas.py` holds the API's models, and `app/messages.py` the Pub/Sub messages, checked against `../contracts`.
- `app/gcp/`: signed URLs and publishing. `app/core/`: settings, the database engine and the registry of live event streams.
- `migrations/`: Alembic.
