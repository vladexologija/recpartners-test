import json
from pathlib import Path

import pytest

from app.messages import Job, analysis_event

CONTRACTS = Path(__file__).parents[2] / "contracts"


def example(name: str) -> dict[str, object]:
    loaded: dict[str, object] = json.loads((CONTRACTS / name).read_text())
    return loaded


def test_job_matches_the_shared_contract() -> None:
    """The worker's copy of the models is checked against the same files (D11)."""
    assert Job.model_validate(example("job.json")).model_dump(mode="json") == example("job.json")


@pytest.mark.parametrize(
    "name", ["event-started.json", "event-progress.json", "event-done.json", "event-failed.json"]
)
def test_worker_events_match_the_shared_contract(name: str) -> None:
    event = analysis_event.validate_python(example(name))
    assert event.model_dump(mode="json") == example(name)
