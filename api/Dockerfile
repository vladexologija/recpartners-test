# hotdog-web (D11): the FastAPI app and the built single-page app it serves. The build context is
# the repository root (infra/build.yaml), because the image needs web/ as well as api/.

FROM node:24-slim AS spa
RUN npm install --global pnpm@10.15.0
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

FROM python:3.12-slim-trixie
COPY --from=ghcr.io/astral-sh/uv:0.12.19 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
# app/main.py serves ../web/dist relative to api/, so the two sit side by side here too.
WORKDIR /app/api
COPY api/pyproject.toml api/uv.lock api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/ ./
COPY --from=spa /web/dist /app/web/dist
ENV PATH="/app/api/.venv/bin:$PATH"
CMD ["fastapi", "run", "--port", "8080"]
