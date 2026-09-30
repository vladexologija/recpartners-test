from fastapi.testclient import TestClient

from app.main import app


def test_openapi_is_served() -> None:
    response = TestClient(app).get("/openapi.json")
    assert response.status_code == 200
