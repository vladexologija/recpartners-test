from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import SessionDep
from app.schemas import Health

router = APIRouter(tags=["health"])


@router.get("/healthz")
def healthz(session: SessionDep) -> Health:
    session.scalar(text("SELECT 1"))
    return Health(status="ok")
