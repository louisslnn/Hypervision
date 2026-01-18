import os

from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_sync_creates_run():
    username = os.getenv("CHESSCOM_USERNAME", "infinitely_0")
    response = client.post("/api/sync", json={"username": username})
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["player_username"] == username
    assert payload["archives_total"] >= 0
    assert payload["months_fetched"] + payload["months_not_modified"] == payload["archives_total"]
    assert "created_at" in payload
    assert payload["finished_at"] is not None


def test_sync_status_returns_last_run():
    username = os.getenv("CHESSCOM_USERNAME", "infinitely_0")
    client.post("/api/sync", json={"username": username})
    response = client.get("/api/sync/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "ok"
    assert payload["last_run"] is not None
    assert payload["last_run"]["player_username"] == username
