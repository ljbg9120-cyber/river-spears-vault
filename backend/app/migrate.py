"""Add columns that shipped after a database was already created.

SQLAlchemy's create_all only makes missing *tables*, never missing columns, so
a live instance keeps its old schema when a model grows a field. This runs at
startup and is a no-op once a column exists.

Anything beyond adding nullable/defaulted columns should move to Alembic.
"""
from __future__ import annotations

import logging

from sqlalchemy import Engine, inspect, text

log = logging.getLogger("vault.migrate")

# table -> column -> the DDL type + default used to add it
ADDITIONS: dict[str, dict[str, str]] = {
    "tracks": {
        "lyrics": "TEXT NOT NULL DEFAULT ''",
        "showcased": "BOOLEAN NOT NULL DEFAULT 0",
        "status": "VARCHAR(16) NOT NULL DEFAULT 'demo'",
        "is_favorite": "BOOLEAN NOT NULL DEFAULT 0",
        "version_root_id": "VARCHAR(32)",
        "version_number": "INTEGER NOT NULL DEFAULT 1",
        "revision_note": "TEXT NOT NULL DEFAULT ''",
    },
    "folders": {
        "cover_name": "VARCHAR(64)",
        "showcased": "BOOLEAN NOT NULL DEFAULT 0",
    },
    "comments": {
        "resolved": "BOOLEAN NOT NULL DEFAULT 0",
        "resolved_at": "DATETIME",
    },
}


def run(engine: Engine) -> list[str]:
    applied: list[str] = []
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    with engine.begin() as conn:
        for table, columns in ADDITIONS.items():
            if table not in existing_tables:
                continue  # create_all will build it complete
            present = {c["name"] for c in inspector.get_columns(table)}
            for column, ddl in columns.items():
                if column in present:
                    continue
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}"))
                applied.append(f"{table}.{column}")
                log.info("added column %s.%s", table, column)

    return applied
