"""The only GCS module (D9): signed URLs for the upload and for playback."""

from dataclasses import dataclass
from datetime import timedelta
from typing import Any, Protocol

import google.auth
from google.api_core.exceptions import NotFound
from google.auth import compute_engine
from google.auth.credentials import Credentials, Signing
from google.auth.transport.requests import Request
from google.cloud import storage

UPLOAD_URL_TTL = timedelta(minutes=30)
PLAYBACK_URL_TTL = timedelta(hours=6)


@dataclass(frozen=True)
class SignedUpload:
    url: str
    headers: dict[str, str]  # the browser must send these exactly: they are part of the signature


class Storage(Protocol):
    def upload_target(self, object_name: str, size: int) -> SignedUpload: ...

    def playback_url(self, object_name: str) -> str: ...

    def delete(self, object_name: str) -> None: ...


class GcsStorage:
    def __init__(self, bucket: str, credentials: Credentials | None = None) -> None:
        """Uses the environment's credentials (Application Default Credentials) unless given."""
        if credentials is None:
            credentials, _ = google.auth.default()
        self._credentials = credentials
        self._bucket = storage.Client(credentials=credentials, project="-").bucket(bucket)

    def upload_target(self, object_name: str, size: int) -> SignedUpload:
        # GCS enforces these: exactly the declared size (400 otherwise), and no overwrite (412).
        rules = {"x-goog-content-length-range": f"{size},{size}", "x-goog-if-generation-match": "0"}
        url = self._bucket.blob(object_name).generate_signed_url(
            version="v4",
            method="PUT",
            expiration=UPLOAD_URL_TTL,
            content_type="video/mp4",
            headers=dict(rules),  # a copy: the library adds "Host" to the dict it is given
            **self._signing_args(),
        )
        return SignedUpload(url=url, headers={"Content-Type": "video/mp4", **rules})

    def playback_url(self, object_name: str) -> str:
        url: str = self._bucket.blob(object_name).generate_signed_url(
            version="v4", method="GET", expiration=PLAYBACK_URL_TTL, **self._signing_args()
        )
        return url

    def delete(self, object_name: str) -> None:
        """Idempotent: an object that is already gone is fine."""
        try:
            self._bucket.blob(object_name).delete()
        except NotFound:
            pass

    def _signing_args(self) -> dict[str, Any]:
        credentials = self._credentials
        if isinstance(credentials, Signing):
            # A service-account key, or an impersonated account locally: they sign directly.
            return {"credentials": credentials}
        if isinstance(credentials, compute_engine.Credentials):
            # Cloud Run has no private key: sign through the IAM API as the service's account.
            if not credentials.valid:
                credentials.refresh(Request())
            return {
                "service_account_email": credentials.service_account_email,
                "access_token": credentials.token,
            }
        raise RuntimeError(
            "Signing URLs needs a service account. Locally, run: gcloud auth "
            "application-default login --impersonate-service-account=<account>"
        )
