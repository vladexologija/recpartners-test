from fastapi.testclient import TestClient


def test_healthz_is_ok_when_the_database_answers(client: TestClient) -> None:
    response = client.get("/api/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
