"""The database engine, created on first use so importing the app never needs a database."""

from functools import lru_cache

from sqlalchemy import Engine
from sqlmodel import create_engine

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True)
