from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect


def tables(url: str) -> set[str]:
    engine = create_engine(url)
    try:
        return set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_upgrade_creates_the_schema(database_url: str) -> None:
    assert {"videos", "analyses", "detections"} <= tables(database_url)


def test_downgrade_and_upgrade_again(database_url: str) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    command.downgrade(config, "base")
    assert tables(database_url) == {"alembic_version"}
    command.upgrade(config, "head")
    assert {"videos", "analyses", "detections"} <= tables(database_url)


def test_migrations_match_the_models(database_url: str) -> None:
    """Fails when a model changed without a migration: run `alembic revision --autogenerate`."""
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    command.check(config)
