"""add engine analysis tables

Revision ID: 0004_add_engine_analysis_tables
Revises: 0003_add_moves_table
Create Date: 2025-01-12 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0004_add_engine_analysis_tables"
down_revision = "0003_add_moves_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "engine_positions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("fen_hash", sa.String(length=64), nullable=False),
        sa.Column("fen", sa.String(length=100), nullable=False),
        sa.Column("side_to_move", sa.String(length=1), nullable=False),
        sa.Column("engine_name", sa.String(length=64), nullable=False),
        sa.Column("engine_version", sa.String(length=32), nullable=False),
        sa.Column("analysis_depth", sa.Integer(), nullable=False),
        sa.Column("analysis_time_ms", sa.Integer(), nullable=False),
        sa.Column("analysis_multipv", sa.Integer(), nullable=False),
        sa.Column("analysis_version", sa.String(length=128), nullable=False),
        sa.Column("eval_cp", sa.Integer(), nullable=True),
        sa.Column("eval_mate", sa.Integer(), nullable=True),
        sa.Column("pv_uci", sa.Text(), nullable=True),
        sa.Column("multipv_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "fen_hash",
            "analysis_version",
            name="uq_engine_positions_fen_hash_version",
        ),
    )
    op.create_index("ix_engine_positions_fen_hash", "engine_positions", ["fen_hash"])

    op.create_table(
        "move_analysis",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("move_id", sa.Integer(), nullable=False),
        sa.Column("analysis_version", sa.String(length=128), nullable=False),
        sa.Column("eval_before_cp", sa.Integer(), nullable=True),
        sa.Column("eval_before_mate", sa.Integer(), nullable=True),
        sa.Column("eval_after_cp", sa.Integer(), nullable=True),
        sa.Column("eval_after_mate", sa.Integer(), nullable=True),
        sa.Column("cpl", sa.Integer(), nullable=True),
        sa.Column("best_move_uci", sa.String(length=16), nullable=True),
        sa.Column("best_eval_cp", sa.Integer(), nullable=True),
        sa.Column("best_eval_mate", sa.Integer(), nullable=True),
        sa.Column("classification", sa.String(length=16), nullable=False),
        sa.Column("tags_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["move_id"], ["moves.id"]),
        sa.UniqueConstraint("move_id", "analysis_version", name="uq_move_analysis_move_version"),
    )
    op.create_index("ix_move_analysis_move_id", "move_analysis", ["move_id"])


def downgrade() -> None:
    op.drop_index("ix_move_analysis_move_id", table_name="move_analysis")
    op.drop_table("move_analysis")

    op.drop_index("ix_engine_positions_fen_hash", table_name="engine_positions")
    op.drop_table("engine_positions")
