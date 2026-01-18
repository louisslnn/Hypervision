import logging

from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)


def test_request_id_headers_and_logs(caplog):
    caplog.set_level(logging.INFO)
    response = client.get(
        "/api/health",
        headers={"X-Request-ID": "req-123", "X-Correlation-ID": "corr-456"},
    )
    assert response.status_code == 200
    assert response.headers["X-Request-ID"] == "req-123"
    assert response.headers["X-Correlation-ID"] == "corr-456"

    matching = [
        record for record in caplog.records if getattr(record, "request_id", None) == "req-123"
    ]
    assert matching
