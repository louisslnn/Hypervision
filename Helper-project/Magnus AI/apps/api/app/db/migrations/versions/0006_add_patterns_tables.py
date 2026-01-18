"""add patterns tables

Revision ID: 0006_add_patterns_tables
Revises: 0005_add_llm_outputs_table
Create Date: 2025-01-13 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0006_add_patterns_tables"
down_revision = "0005_add_llm_outputs_table"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "patterns",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("player_id", sa.Integer(), nullable=False),
        sa.Column("analysis_version", sa.String(length=128), nullable=False),
        sa.Column("pattern_key", sa.String(length=64), nullable=False),
        sa.Column("title", sa.String(length=128), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("severity_score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("occurrences", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("average_cpl", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["player_id"], ["players.id"]),
        sa.UniqueConstraint(
            "player_id",
            "analysis_version",
            "pattern_key",
            name="uq_patterns_player_version_key",
        ),
    )
    op.create_index("ix_patterns_player_id", "patterns", ["player_id"])
    op.create_index("ix_patterns_analysis_version", "patterns", ["analysis_version"])

    op.create_table(
        "pattern_examples",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("pattern_id", sa.Integer(), nullable=False),
        sa.Column("game_id", sa.Integer(), nullable=False),
        sa.Column("move_id", sa.Integer(), nullable=False),
        sa.Column("fen", sa.String(length=100), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["pattern_id"], ["patterns.id"]),
        sa.ForeignKeyConstraint(["game_id"], ["games.id"]),
        sa.ForeignKeyConstraint(["move_id"], ["moves.id"]),
        sa.UniqueConstraint(
            "pattern_id",
            "move_id",
            name="uq_pattern_examples_pattern_move",
        ),
    )
    op.create_index("ix_pattern_examples_pattern_id", "pattern_examples", ["pattern_id"])
    op.create_index("ix_pattern_examples_game_id", "pattern_examples", ["game_id"])
    op.create_index("ix_pattern_examples_move_id", "pattern_examples", ["move_id"])


def downgrade() -> None:
    op.drop_index("ix_pattern_examples_move_id", table_name="pattern_examples")
    op.drop_index("ix_pattern_examples_game_id", table_name="pattern_examples")
    op.drop_index("ix_pattern_examples_pattern_id", table_name="pattern_examples")
    op.drop_table("pattern_examples")
    op.drop_index("ix_patterns_analysis_version", table_name="patterns")
    op.drop_index("ix_patterns_player_id", table_name="patterns")
    op.drop_table("patterns")
