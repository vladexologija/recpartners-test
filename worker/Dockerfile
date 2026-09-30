# hotdog-worker (D4, D11): ffmpeg, CPU-only torch, ultralytics and the model weights.

FROM python:3.12-slim-trixie
RUN apt-get update && apt-get install --yes --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
# The weights are not in git: the release asset, checked against the committed SHA-256 (D4).
ADD https://github.com/ultralytics/assets/releases/download/v8.4.0/yolo26n.pt models/
COPY models/yolo26n.pt.sha256 models/
RUN cd models && sha256sum --check yolo26n.pt.sha256
COPY app/ app/
# ultralytics writes a settings file when first imported; keep it out of the image's home.
ENV PATH="/app/.venv/bin:$PATH" YOLO_CONFIG_DIR=/tmp/Ultralytics
CMD ["fastapi", "run", "--port", "8080"]
