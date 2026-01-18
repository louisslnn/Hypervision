from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from app.core.constants import CHESSCOM_ENDPOINT_GAMES, INGEST_VERSION, SYNC_VERSION
from app.db import models
from app.services.chesscom import ChesscomClient, FetchResult


def parse_archive_url(archive_url: str) -> tuple[int, int]:
    parts = archive_url.rstrip("/").split("/")
    if len(parts) < 2:
        raise ValueError(f"Invalid archive URL: {archive_url}")
    year = int(parts[-2])
    month = int(parts[-1])
    return year, month


def parse_timestamp(value: Any) -> Optional[datetime]:
    if isinstance(value, int):
        return datetime.fromtimestamp(value, tz=timezone.utc)
    return None


def find_existing_uuids(db: Session, player_id: int) -> set[str]:
    stmt = select(models.Game.uuid).where(models.Game.player_id == player_id)
    return set(db.execute(stmt).scalars().all())


def create_game(player_id: int, payload: dict[str, Any]) -> Optional[models.Game]:
    uuid = payload.get("uuid")
    url = payload.get("url")
    if not uuid or not url:
        return None

    white = payload.get("white") or {}
    black = payload.get("black") or {}

    return models.Game(
        player_id=player_id,
        uuid=uuid,
        chesscom_url=url,
        start_time=parse_timestamp(payload.get("start_time")),
        end_time=parse_timestamp(payload.get("end_time")),
        time_control=payload.get("time_control"),
        time_class=payload.get("time_class"),
        rated=payload.get("rated"),
        rules=payload.get("rules"),
        white_username=white.get("username"),
        black_username=black.get("username"),
        white_rating_post=white.get("rating"),
        black_rating_post=black.get("rating"),
        result_white=white.get("result"),
        result_black=black.get("result"),
        pgn_raw=payload.get("pgn"),
        eco_url=payload.get("eco_url"),
        ingest_version=INGEST_VERSION,
    )


def get_last_ingest_meta(
    db: Session, player_id: int, year: int, month: int
) -> tuple[Optional[str], Optional[str]]:
    stmt = (
        select(models.RawIngest)
        .where(
            models.RawIngest.player_id == player_id,
            models.RawIngest.year == year,
            models.RawIngest.month == month,
            models.RawIngest.endpoint == CHESSCOM_ENDPOINT_GAMES,
        )
        .order_by(desc(models.RawIngest.fetched_at))
    )
    last = db.execute(stmt).scalars().first()
    if not last:
        return None, None
    return last.etag, last.last_modified


def record_raw_ingest(
    db: Session,
    player_id: int,
    year: int,
    month: int,
    result: FetchResult,
) -> None:
    raw = models.RawIngest(
        player_id=player_id,
        year=year,
        month=month,
        endpoint=CHESSCOM_ENDPOINT_GAMES,
        status_code=result.status_code,
        not_modified=result.status_code == 304,
        etag=result.etag,
        last_modified=result.last_modified,
        payload_json=result.payload,
        ingest_version=INGEST_VERSION,
    )
    db.add(raw)


def run_sync(
    db: Session,
    username: str,
    client: Optional[ChesscomClient] = None,
) -> models.SyncRun:
    normalized = username.strip()
    if not normalized:
        raise ValueError("Username is required.")

    player_stmt = select(models.Player).where(models.Player.username == normalized)
    player = db.execute(player_stmt).scalars().first()
    if not player:
        player = models.Player(username=normalized)
        db.add(player)
        db.commit()
        db.refresh(player)

    run = models.SyncRun(
        status="running",
        player_username=normalized,
        sync_version=SYNC_VERSION,
        archives_total=0,
        months_fetched=0,
        months_not_modified=0,
        games_upserted=0,
        games_skipped=0,
    )
    db.add(run)
    db.commit()
    db.refresh(run)

    archives_total = 0
    months_fetched = 0
    months_not_modified = 0
    games_upserted = 0
    games_skipped = 0

    sync_client = client or ChesscomClient()

    try:
        archives = sync_client.fetch_archives(normalized)
        archives_total = len(archives)

        existing_uuids = find_existing_uuids(db, player.id)

        for archive_url in archives:
            year, month = parse_archive_url(archive_url)
            etag, last_modified = get_last_ingest_meta(db, player.id, year, month)
            result = sync_client.fetch_month(normalized, year, month, etag, last_modified)
            record_raw_ingest(db, player.id, year, month, result)
            db.commit()

            if result.status_code == 304:
                months_not_modified += 1
                continue

            months_fetched += 1
            payload = result.payload or {}
            games = payload.get("games") or []
            if not isinstance(games, list):
                raise ValueError(f"Unexpected games payload for {year}/{month}.")

            for game_payload in games:
                game = create_game(player.id, game_payload)
                if not game or game.uuid in existing_uuids:
                    games_skipped += 1
                    continue
                db.add(game)
                existing_uuids.add(game.uuid)
                games_upserted += 1

            db.commit()

        run.status = "completed"
        run.finished_at = datetime.now(timezone.utc)
    except Exception as exc:
        db.rollback()
        run.status = "failed"
        run.error_message = str(exc)
        run.finished_at = datetime.now(timezone.utc)
        raise
    finally:
        run.archives_total = archives_total
        run.months_fetched = months_fetched
        run.months_not_modified = months_not_modified
        run.games_upserted = games_upserted
        run.games_skipped = games_skipped
        db.commit()
        db.refresh(run)

    return run
