"""add llm outputs table

Revision ID: 0005_add_llm_outputs_table
Revises: 0004_add_engine_analysis_tables
Create Date: 2025-01-12 00:00:00.000000

"""

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision = "0005_add_llm_outputs_table"
down_revision = "0004_add_engine_analysis_tables"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "llm_outputs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("scope_type", sa.String(length=32), nullable=False),
        sa.Column("scope_id", sa.Integer(), nullable=False),
        sa.Column("input_hash", sa.String(length=64), nullable=False),
        sa.Column("model", sa.String(length=64), nullable=False),
        sa.Column("prompt_version", sa.String(length=32), nullable=False),
        sa.Column("schema_version", sa.String(length=32), nullable=False),
        sa.Column("output_json", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "scope_type",
            "scope_id",
            "input_hash",
            name="uq_llm_outputs_scope_hash",
        ),
    )
    op.create_index("ix_llm_outputs_scope_type", "llm_outputs", ["scope_type"])
    op.create_index("ix_llm_outputs_scope_id", "llm_outputs", ["scope_id"])


def downgrade() -> None:
    op.drop_index("ix_llm_outputs_scope_id", table_name="llm_outputs")
    op.drop_index("ix_llm_outputs_scope_type", table_name="llm_outputs")
    op.drop_table("llm_outputs")
