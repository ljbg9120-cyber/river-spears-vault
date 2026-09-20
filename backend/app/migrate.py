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
    "users": {
        "avatar_name": "VARCHAR(80)",
        "banner_name": "VARCHAR(80)",
        "pronouns": "VARCHAR(40) NOT NULL DEFAULT ''",
        # A JSON column added later is NULL on existing rows, which is not a
        # list; BACKFILL below fixes those.
        "links": "TEXT",
        "profile_accent": "VARCHAR(16) NOT NULL DEFAULT ''",
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


# column -> value to write wherever an added column is still NULL.
BACKFILL: dict[str, dict[str, str]] = {
    "users": {"links": "'[]'"},
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

    # Newly added columns start NULL on existing rows. Anything typed as a
    # list or object in the API needs a real value or responses fail to
    # validate for everyone who signed up before the migration.
    with engine.begin() as conn:
        for table, columns in BACKFILL.items():
            if table not in existing_tables:
                continue
            for column, value in columns.items():
                present = {c["name"] for c in inspect(engine).get_columns(table)}
                if column not in present:
                    continue
                conn.execute(
                    text(f"UPDATE {table} SET {column} = {value} WHERE {column} IS NULL")
                )

    return applied
