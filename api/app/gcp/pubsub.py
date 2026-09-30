"""Publishes jobs to the worker through Pub/Sub (D3). Honors PUBSUB_EMULATOR_HOST locally."""

from typing import Protocol

from google.cloud import pubsub_v1

from app.messages import Job

PUBLISH_TIMEOUT_S = 30


class Publisher(Protocol):
    def publish_job(self, job: Job) -> None: ...


class PubSubPublisher:
    def __init__(self, project_id: str, topic: str) -> None:
        self._client = pubsub_v1.PublisherClient()
        self._topic = self._client.topic_path(project_id, topic)

    def publish_job(self, job: Job) -> None:
        # Wait for Pub/Sub's confirmation: the caller responds only once the job is durable (D2).
        future = self._client.publish(self._topic, job.model_dump_json().encode())
        future.result(timeout=PUBLISH_TIMEOUT_S)
