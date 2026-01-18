"""add moves table

Revision ID: 0003_add_moves_table
Revises: 0002_add_sync_ingest_tables
Create Date: 2025-01-10 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0003_add_moves_table"
down_revision = "0002_add_sync_ingest_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "moves",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("ply", sa.Integer(), nullable=False),
        sa.Column("move_san", sa.String(length=32), nullable=False),
        sa.Column("move_uci", sa.String(length=16), nullable=False),
        sa.Column("fen_before", sa.String(length=100), nullable=False),
        sa.Column("fen_after", sa.String(length=100), nullable=False),
        sa.Column("is_check", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("is_mate", sa.Boolean(), server_default=sa.text("0"), nullable=False),
        sa.Column("capture_piece", sa.String(length=8), nullable=True),
        sa.Column("promotion", sa.String(length=8), nullable=True),
        sa.Column("clock_remaining_ms", sa.Integer(), nullable=True),
        sa.Column("time_spent_ms", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"]),
        sa.UniqueConstraint("game_id", "ply", name="uq_moves_game_ply"),
    )
    op.create_index("ix_moves_game_id", "moves", ["game_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_moves_game_id", table_name="moves")
    op.drop_table("moves")
