"""Downloads uploaded videos from GCS."""

from pathlib import Path
from typing import Protocol

from google.cloud import storage


class Storage(Protocol):
    def download(self, object_name: str, destination: Path) -> None: ...


class GcsStorage:
    def __init__(self, project_id: str, bucket: str) -> None:
        self._bucket = storage.Client(project=project_id).bucket(bucket)

    def download(self, object_name: str, destination: Path) -> None:
        # The signed upload forbade overwriting (x-goog-if-generation-match: 0), so the object
        # can only be the uploaded video: no generation check is needed.
        self._bucket.blob(object_name).download_to_filename(str(destination))
