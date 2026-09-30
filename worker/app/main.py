from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI

from app.api.deps import get_detector
from app.api.routes import process


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    get_detector()  # load the model at container start, not on the first job (D3a)
    yield


app = FastAPI(title="Hot-dog detector worker", lifespan=lifespan)
app.include_router(process.router)
