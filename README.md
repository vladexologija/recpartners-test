# Hot-dog detector

Delivered as a live deployment: open the link, nothing to install.

**https://hotdog-web-611435492821.europe-west1.run.app** (health check: [`/api/healthz`](https://hotdog-web-611435492821.europe-west1.run.app/api/healthz))

Upload an MP4 (up to 200 MB and 15 minutes). It goes straight to Cloud Storage, a worker samples it at 2 frames per second and runs YOLO26n on every sample, and the page follows the job live and then plays the video with a box over each hot dog.

## Try it

Already processed:
- [A man eating a hot dog by Lake Michigan](https://hotdog-web-611435492821.europe-west1.run.app/videos/19a43d4c-03bb-49d6-afff-36c625a7c2bb): hot dog in 37 of 37 sampled frames
- [A hot dog held close to the camera](https://hotdog-web-611435492821.europe-west1.run.app/videos/748a6ee7-64b8-43b1-a074-56a0b1e1f7d8): 21 of 21
- [A 14:50 1080p test pattern](https://hotdog-web-611435492821.europe-west1.run.app/videos/5f38a85c-268c-42a1-adaa-6151be252622): no hot dog; the longest video allowed, processed in 201 s

The two real clips are from Pexels ([one](https://www.pexels.com/video/man-enjoying-hot-dog-by-lake-michigan-32304961/), [two](https://www.pexels.com/video/close-up-of-holding-a-hot-dog-outdoors-32304951/)). The home page offers both as samples: picking one runs the same checks, upload and processing as your own MP4. Things worth trying:
1. Refresh while it is processing: the page picks the job up again.
2. Seek, pause and resize the window: the boxes stay on the picture.
3. Press Reprocess on a finished video: the same analysis runs again and keeps one set of results.
4. Upload something that isn't an MP4, or is longer than 15 minutes: it is refused with a reason.

## Where to read

- [`NOTES.md`](NOTES.md): the architecture and why, the sampling rate, a 2-hour video, what is left out
- [`docs/design.md`](docs/design.md), Part 0: the decision log, with the alternatives considered
- [`worker/app/process.py`](worker/app/process.py): one job, from download to the `done` event
- [`api/app/handlers.py`](api/app/handlers.py) and [`api/app/crud.py`](api/app/crud.py): the Pub/Sub handlers and the status-guarded writes that make redelivery safe
- [`api/app/api/routes/videos.py`](api/app/api/routes/videos.py): the upload, Reprocess and the live event stream
- [`web/src/features/video/Player.tsx`](web/src/features/video/Player.tsx) and [`overlay.ts`](web/src/features/video/overlay.ts): the box overlay and its timing
- [`infra/`](infra/): the whole platform in Terraform
- [`docs/requirements.md`](docs/requirements.md): each requirement and the tests that cover it

## Architecture

```
browser ──signed PUT──► GCS bucket ──OBJECT_FINALIZE──► topic uploads ──push──► hotdog-web
                                                                               (API + app, 1 instance)
hotdog-web ──topic analysis-jobs ──push, OIDC──► hotdog-worker (private, 1 job per instance, 0–3)
                                                  download → ffprobe → ffmpeg 2 fps → YOLO26n
hotdog-worker ──topic analysis-events ──push──► hotdog-web ──► Postgres (Cloud SQL) ──SSE──► browser
```

Pub/Sub carries every hop, so Cloud Run scales the worker with the queue and nothing polls. The worker has no database: web's status-guarded writes are the only place state changes, and every handler is idempotent, because Pub/Sub delivers at least once.

## Set it up yourself (from a clean machine)

You don't need this to review: the live deployment above is the way to run it. These steps build the same deployment in your own Google Cloud project, in about 30 minutes. The author ran them from macOS on 2026-09-30 to create `hotdog-takehome-6293`; they have not yet been rehearsed in a fresh project.

You need a Google account with a billing account. The images are built in Cloud Build, so no Docker, Python or Node is needed on your machine.

**1. Install the tools.** On macOS, with [Homebrew](https://brew.sh) (its installer also brings `git` and `make`):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
brew install --cask gcloud-cli
brew tap hashicorp/tap && brew install hashicorp/tap/terraform
```

On Linux: `sudo apt-get install -y git make`, then the [gcloud CLI](https://cloud.google.com/sdk/docs/install) and [Terraform](https://developer.hashicorp.com/terraform/install) from their official instructions. Terraform must be 1.11 or later.

**2. Sign in.** Each command opens a browser. The second one gives Terraform its credentials.

```bash
gcloud auth login
gcloud auth application-default login
```

**3. Create a project and link it to your billing account.** Run these from the repository's root; the later steps use `$PROJECT`, so stay in the same terminal.

```bash
export PROJECT=hotdog-$RANDOM
gcloud projects create $PROJECT
gcloud billing accounts list          # copy the ACCOUNT_ID of an open account
gcloud billing projects link $PROJECT --billing-account=ACCOUNT_ID
```

**4. Configure.** This names the project and the region, and keeps one worker warm (about $1.30 a day). `make release` commits a file, so git needs a name if it has none yet.

```bash
printf 'project_id = "%s"\nregion     = "europe-west1"\nworker_min_instances = 1\n' $PROJECT > infra/terraform.tfvars
git config user.name >/dev/null || git config --global user.name "Your Name"
git config user.email >/dev/null || git config --global user.email "you@example.com"
```

**5. Deploy.** Answer `yes` when Terraform asks.

```bash
make bootstrap   # about 2 min: the APIs, the Terraform state bucket, terraform init, a $50 budget alert
make infra       # about 15 min: everything except the services (Cloud SQL is the slow part)
make release     # about 10 min: builds both images, runs the migrations, deploys, commits the image pointer
terraform -chdir=infra output -raw url   # the app's address
```

- **The budget alert** is `make bootstrap`'s last step. It needs permission to manage budgets on the billing account. If it fails, everything before it is done, and you can go on without it.
- **The first job may wait a few minutes.** Pub/Sub's first deliveries to the worker get 403 until the worker's new invoker permission takes effect. Pub/Sub retries, so nothing is lost.
- **Organization policies apply** if your project sits in an organization. Domain-restricted sharing is fine: the app turns off Cloud Run's invoker check instead of granting `allUsers`. A policy that forbids public IPs on Cloud SQL stops `make infra`.

**6. Tear it down** when you're done. Deleting the project removes everything in it:

```bash
gcloud projects delete $PROJECT
```

## Local development

```bash
make sync            # dependencies for api/, worker/ and web/, and the model weights (make model)
make check           # ruff, mypy and pytest for both Python projects, tsc and vitest, and the API contract
make db              # Postgres 17 in Docker on port 5433, migrated (for fastapi dev in api/)
cd web && pnpm dev:mock   # the app against an in-memory stand-in for the API
```

The API's tests start Postgres with testcontainers (Docker). Without Docker, point them at an empty database kept for them: `HOTDOG_TEST_DATABASE_URL=postgresql+psycopg://user@localhost:5434/test uv run pytest`. There is no local run of the whole pipeline yet: the Pub/Sub and GCS emulators are designed ([`docs/design.md`](docs/design.md) D14) but not wired up.

## Tests

- **api/** (47): against real Postgres. The migrations and model drift, the guarded handlers for uploads and worker events (duplicates, out-of-order and late events), the idempotent create, Reprocess, the live event stream, signed URLs and the upload rate limit.
- **worker/** (31): real ffmpeg on clips generated at test time (rotation, non-square pixels, audio-only, not-MP4), the job's events and failures, and two tests with the real model.
- **web/** (112): the upload checks and samples, the player's overlay geometry and timing, and the live status.

## Cost, limits and teardown

- Web runs as one instance; the worker runs 0–3, with one kept warm while this is being reviewed (about $1.30 a day). Cloud SQL is the smallest shared-core instance.
- Uploads are limited to 200 MB and 15 minutes each, and to 30 new videos an hour and 200 a day across everyone.
- A budget alert emails at 50%, 90% and 100% of $50. It warns; it does not cap spending.
- After the review window, `make pause` stops keeping a worker warm.
- To tear everything down, delete the project (`gcloud projects delete hotdog-takehome-6293`). To keep the project, set `protect_db = false` and run `make infra`, empty the uploads bucket, then `make destroy`.
