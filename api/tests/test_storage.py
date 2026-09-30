"""The real GCS signing, offline: a throwaway service-account key signs locally, no network."""

from urllib.parse import parse_qs, urlsplit

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from google.oauth2 import credentials as user_credentials
from google.oauth2 import service_account

from app.gcp.storage import GcsStorage


@pytest.fixture(scope="module")
def storage() -> GcsStorage:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    credentials = service_account.Credentials.from_service_account_info(
        {
            "client_email": "signer@test-project.iam.gserviceaccount.com",
            "private_key": pem,
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    )
    return GcsStorage("hotdog-uploads", credentials=credentials)


def test_the_upload_url_signs_the_upload_rules(storage: GcsStorage) -> None:
    upload = storage.upload_target("videos/abc.mp4", size=1234)
    url = urlsplit(upload.url)
    query = parse_qs(url.query)
    assert (url.hostname, url.path) == ("storage.googleapis.com", "/hotdog-uploads/videos/abc.mp4")
    assert query["X-Goog-Algorithm"] == ["GOOG4-RSA-SHA256"]
    assert query["X-Goog-Expires"] == ["1800"]
    assert set(query["X-Goog-SignedHeaders"][0].split(";")) >= {
        "content-type",
        "x-goog-content-length-range",
        "x-goog-if-generation-match",
    }
    assert upload.headers == {
        "Content-Type": "video/mp4",
        "x-goog-content-length-range": "1234,1234",
        "x-goog-if-generation-match": "0",
    }


def test_the_playback_url_is_a_signed_get(storage: GcsStorage) -> None:
    query = parse_qs(urlsplit(storage.playback_url("videos/abc.mp4")).query)
    assert query["X-Goog-Expires"] == ["21600"]
    assert query["X-Goog-SignedHeaders"] == ["host"]


def test_user_credentials_cannot_sign() -> None:
    storage = GcsStorage("hotdog-uploads", credentials=user_credentials.Credentials(token="t"))
    with pytest.raises(RuntimeError, match="needs a service account"):
        storage.playback_url("videos/abc.mp4")
