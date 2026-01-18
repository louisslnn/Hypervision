"""add ingest tables and expand sync_runs

Revision ID: 0002_add_sync_ingest_tables
Revises: 0001_create_sync_runs
Create Date: 2025-01-07 00:10:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0002_add_sync_ingest_tables"
down_revision = "0001_create_sync_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "players",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("username", sa.String(length=64), nullable=False, unique=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_players_username", "players", ["username"], unique=True)

    op.create_table(
        "raw_ingest",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("month", sa.Integer(), nullable=False),
        sa.Column("endpoint", sa.String(length=32), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=False),
        sa.Column("not_modified", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("etag", sa.String(length=255), nullable=True),
        sa.Column("last_modified", sa.String(length=255), nullable=True),
        sa.Column("payload_json", sa.JSON(), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("ingest_version", sa.String(length=32), nullable=False),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
    )
    op.create_index("ix_raw_ingest_player_id", "raw_ingest", ["player_id"], unique=False)

    op.create_table(
        "games",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("uuid", sa.String(length=64), nullable=False, unique=True),
        sa.Column("chesscom_url", sa.String(length=255), nullable=False, unique=True),
        sa.Column("start_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_time", sa.DateTime(timezone=True), nullable=True),
        sa.Column("time_control", sa.String(length=32), nullable=True),
        sa.Column("time_class", sa.String(length=32), nullable=True),
        sa.Column("rated", sa.Boolean(), nullable=True),
        sa.Column("rules", sa.String(length=16), nullable=True),
        sa.Column("white_username", sa.String(length=64), nullable=True),
        sa.Column("black_username", sa.String(length=64), nullable=True),
        sa.Column("white_rating_post", sa.Integer(), nullable=True),
        sa.Column("black_rating_post", sa.Integer(), nullable=True),
        sa.Column("result_white", sa.String(length=16), nullable=True),
        sa.Column("result_black", sa.String(length=16), nullable=True),
        sa.Column("pgn_raw", sa.Text(), nullable=True),
        sa.Column("eco_url", sa.String(length=255), nullable=True),
        sa.Column("ingest_version", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
    )
    op.create_index("ix_games_player_id", "games", ["player_id"], unique=False)

    op.add_column("sync_runs", sa.Column("player_username", sa.String(length=64), nullable=True))
    op.add_column(
        "sync_runs",
        sa.Column(
            "sync_version",
            sa.String(length=32),
            server_default=sa.text("'v0.1'"),
            nullable=False,
        ),
    )
    op.add_column(
        "sync_runs",
        sa.Column("archives_total", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "sync_runs",
        sa.Column("months_fetched", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "sync_runs",
        sa.Column("months_not_modified", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "sync_runs",
        sa.Column("games_upserted", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column(
        "sync_runs",
        sa.Column("games_skipped", sa.Integer(), server_default=sa.text("0"), nullable=False),
    )
    op.add_column("sync_runs", sa.Column("error_message", sa.Text(), nullable=True))
    op.add_column("sync_runs", sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("sync_runs", "finished_at")
    op.drop_column("sync_runs", "error_message")
    op.drop_column("sync_runs", "games_skipped")
    op.drop_column("sync_runs", "games_upserted")
    op.drop_column("sync_runs", "months_not_modified")
    op.drop_column("sync_runs", "months_fetched")
    op.drop_column("sync_runs", "archives_total")
    op.drop_column("sync_runs", "sync_version")
    op.drop_column("sync_runs", "player_username")

    op.drop_index("ix_games_player_id", table_name="games")
    op.drop_table("games")

    op.drop_index("ix_raw_ingest_player_id", table_name="raw_ingest")
    op.drop_table("raw_ingest")

    op.drop_index("ix_players_username", table_name="players")
    op.drop_table("players")
