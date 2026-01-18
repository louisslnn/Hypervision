from dataclasses import dataclass
from typing import Any, Optional

import httpx

from app.core.config import get_settings


@dataclass(frozen=True)
class FetchResult:
    status_code: int
    etag: Optional[str]
    last_modified: Optional[str]
    payload: Optional[dict[str, Any]]


class ChesscomClient:
    def __init__(
        self,
        base_url: Optional[str] = None,
        user_agent: Optional[str] = None,
        timeout: float = 10.0,
        client: Optional[httpx.Client] = None,
    ) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.chesscom_base_url).rstrip("/")
        self.user_agent = user_agent or settings.chesscom_user_agent
        self._client = client or httpx.Client(
            timeout=timeout,
            headers={"User-Agent": self.user_agent, "Accept": "application/json"},
        )

    def fetch_archives(self, username: str) -> list[str]:
        url = f"{self.base_url}/pub/player/{username}/games/archives"
        response = self._client.get(url)
        response.raise_for_status()
        payload = response.json()
        archives = payload.get("archives")
        if not isinstance(archives, list):
            raise ValueError("Unexpected archives response payload.")
        return archives

    def fetch_month(
        self,
        username: str,
        year: int,
        month: int,
        etag: Optional[str] = None,
        last_modified: Optional[str] = None,
    ) -> FetchResult:
        headers: dict[str, str] = {}
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        url = f"{self.base_url}/pub/player/{username}/games/{year:04d}/{month:02d}"
        response = self._client.get(url, headers=headers)

        if response.status_code == 304:
            return FetchResult(
                status_code=304,
                etag=response.headers.get("ETag") or etag,
                last_modified=response.headers.get("Last-Modified") or last_modified,
                payload=None,
            )

        response.raise_for_status()
        return FetchResult(
            status_code=response.status_code,
            etag=response.headers.get("ETag"),
            last_modified=response.headers.get("Last-Modified"),
            payload=response.json(),
        )


def get_chesscom_client() -> ChesscomClient:
    return ChesscomClient()
