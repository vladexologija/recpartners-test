from pathlib import Path

from fastapi import FastAPI

from app.api.main import api_router
from app.api.routes import internal

# The React app's production build (`pnpm build` in web/), next to api/ in the repo and in the
# image. FastAPI serves it after the API routes; a browser loading /videos/{id} gets index.html.
FRONTEND_DIR = Path(__file__).resolve().parents[2] / "web" / "dist"

app = FastAPI(title="Hot-dog detector API")
app.include_router(api_router)
app.include_router(internal.router)
# check_dir=False: tests and API-only development run without a build. The release checks
# that the page loads (step 7).
app.frontend("/", directory=FRONTEND_DIR, check_dir=False)
