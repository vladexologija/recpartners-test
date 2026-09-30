# hotdog-worker

The worker, `hotdog-worker` on Cloud Run, reachable only by Pub/Sub. Each push to `POST /internal/process` is one job:
1. Download the video from GCS.
2. Check it with ffprobe.
3. Sample 2 frames a second with ffmpeg.
4. Run YOLO26n on them in batches of 8.
5. Publish `started`, `progress`, and finally `done` (with the boxes) or `failed` to `analysis-events`.

It has no database.

## Set up

```bash
uv sync           # CPU-only torch, from PyTorch's own index
make -C .. model  # the weights, checked against models/yolo26n.pt.sha256
```

ffmpeg and ffprobe must be on the PATH. The image installs Debian's ffmpeg 7.1.

## Test

```bash
uv run pytest
```

The tests generate their clips with ffmpeg and use fakes for GCS, Pub/Sub and the model. Two tests use the real weights, and they skip when those haven't been downloaded. `make -C .. check-worker` also runs ruff and mypy.

## Run it

```bash
cp .env.example .env            # HOTDOG_PROJECT_ID and HOTDOG_BUCKET
uv run fastapi dev --port 8001  # loads the model at startup
```

It reads from real GCS and publishes to real Pub/Sub, so point it at a test project. There is no local setup with emulators yet (`docs/design.md`, D14).

## Settings

- `HOTDOG_PROJECT_ID` and `HOTDOG_BUCKET`.
- `HOTDOG_EVENTS_TOPIC`: default `analysis-events`.
- `HOTDOG_MODEL_PATH`: default `models/yolo26n.pt`.
- `HOTDOG_TORCH_THREADS`: the instance's vCPUs. Unset, it keeps ultralytics' own choice.

## Layout

- `app/process.py`: one job, from the download to the final event.
- `app/pipeline/`: `probe.py` (the ffprobe checks and the display size), `frames.py` (the ffmpeg sampler) and `detector.py` (YOLO through ultralytics).
- `app/gcp/`: the download and the event publisher. `app/api/`: the push endpoint and its dependencies.
- `app/messages.py`: the job and event models, checked against `../contracts`.
