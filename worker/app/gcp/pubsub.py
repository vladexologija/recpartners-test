"""Publishes the worker's events to the API through Pub/Sub (D3). Honors PUBSUB_EMULATOR_HOST."""

from typing import Protocol

from google.cloud import pubsub_v1

from app.messages import DoneEvent, FailedEvent, ProgressEvent, StartedEvent

PUBLISH_TIMEOUT_S = 30

Event = StartedEvent | ProgressEvent | DoneEvent | FailedEvent


class EventPublisher(Protocol):
    def publish(self, event: Event) -> None: ...


class PubSubEventPublisher:
    def __init__(self, project_id: str, topic: str) -> None:
        self._client = pubsub_v1.PublisherClient()
        self._topic = self._client.topic_path(project_id, topic)

    def publish(self, event: Event) -> None:
        # Wait for Pub/Sub's confirmation: an event counts only once it is durable (D2).
        future = self._client.publish(self._topic, event.model_dump_json().encode())
        future.result(timeout=PUBLISH_TIMEOUT_S)
