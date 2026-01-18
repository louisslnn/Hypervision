from __future__ import annotations

import argparse
import time

from app.core.logging import configure_logging, get_logger
from app.db.session import SessionLocal
from app.services.jobs import process_pending_jobs

logger = get_logger("app.worker")


def run_once(limit: int) -> int:
    with SessionLocal() as session:
        processed = process_pending_jobs(session, limit=limit)
        return len(processed)


def run_loop(interval: float, limit: int) -> None:
    while True:
        processed = run_once(limit)
        if processed == 0:
            time.sleep(interval)


def main() -> None:
    parser = argparse.ArgumentParser(description="Magnus AI background job runner")
    parser.add_argument("--once", action="store_true", help="Run a single job batch and exit")
    parser.add_argument("--limit", type=int, default=1, help="Max jobs per cycle")
    parser.add_argument("--interval", type=float, default=2.0, help="Sleep between cycles (sec)")
    args = parser.parse_args()

    configure_logging()
    logger.info(
        "worker.start",
        extra={"event": "worker.start", "mode": "once" if args.once else "loop"},
    )

    if args.once:
        run_once(args.limit)
        return

    run_loop(args.interval, args.limit)


if __name__ == "__main__":
    main()
