import os
from pathlib import Path

import pytest

# Ensure tests never touch the local dev database.
test_db_path = Path(__file__).resolve().parents[1] / "test.db"
os.environ["DATABASE_URL"] = f"sqlite:///{test_db_path.as_posix()}"

from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
    Base.metadata.drop_all(engine)
