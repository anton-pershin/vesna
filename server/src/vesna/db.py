"""SQLite persistence, migrations, and transactional durable-job claims."""

from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import time
from typing import Any, Iterator
from uuid import uuid4

OWNER = "local-user"
_MIGRATIONS = ((1, "001_initial.sql"), (2, "002_item_deletions.sql"))


def summary(row: sqlite3.Row | dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "title": row["title"],
        "source_url": row["source_url"],
        "filename": row["filename"],
        "state": row["state"],
        "error": row["error"],
        "version": row["published_version"],
        "paragraph_count": row["paragraph_count"],
    }


def _deletion_receipt(row: sqlite3.Row) -> dict[str, Any]:
    receipt = dict(row)
    receipt["published_paths"] = json.loads(receipt.pop("published_paths_json"))
    return receipt


class Database:
    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.migrate()
        self._secure_files()

    def _secure_files(self) -> None:
        for path in (self.path, Path(f"{self.path}-wal"), Path(f"{self.path}-shm")):
            try:
                path.chmod(0o600)
            except FileNotFoundError:
                pass

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 30000")
        connection.execute("PRAGMA journal_mode = WAL")
        return connection

    @contextmanager
    def transaction(self) -> Iterator[sqlite3.Connection]:
        connection = self.connect()
        try:
            connection.execute("BEGIN IMMEDIATE")
            yield connection
            connection.execute("COMMIT")
        except BaseException:
            if connection.in_transaction:
                connection.execute("ROLLBACK")
            raise
        finally:
            connection.close()

    def migrate(self) -> None:
        migration_dir = Path(__file__).with_name("migrations")
        with self.transaction() as connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS schema_migrations "
                "(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL)"
            )
            applied = {
                row[0] for row in connection.execute("SELECT version FROM schema_migrations")
            }
            for version, filename in _MIGRATIONS:
                if version in applied:
                    continue
                sql = (migration_dir / filename).read_text(encoding="utf-8")
                # Remove creation of the migration table, which is managed above.
                sql = sql.replace(
                    "CREATE TABLE schema_migrations (\n"
                    "    version INTEGER PRIMARY KEY,\n"
                    "    applied_at REAL NOT NULL\n"
                    ");\n\n",
                    "",
                    1,
                )
                # Migration files contain plain DDL (no semicolons inside triggers or strings).
                for statement in sql.split(";"):
                    if statement.strip():
                        connection.execute(statement)
                connection.execute(
                    "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
                    (version, time.time()),
                )

    def create_session(self, token_hash: str, ttl_seconds: int) -> None:
        now = time.time()
        with self.transaction() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            connection.execute(
                "INSERT INTO sessions(token_hash, owner, expires_at, created_at) "
                "VALUES (?, ?, ?, ?)",
                (token_hash, OWNER, now + ttl_seconds, now),
            )

    def session_owner(self, token_hash: str) -> str | None:
        now = time.time()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT owner FROM sessions WHERE token_hash = ? AND expires_at > ?",
                (token_hash, now),
            ).fetchone()
            return row["owner"] if row else None

    def delete_session(self, token_hash: str) -> None:
        with self.transaction() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))

    def create_item(
        self,
        *,
        kind: str,
        source_url: str | None = None,
        filename: str | None = None,
        original_path: str | None = None,
        title: str | None = None,
    ) -> dict[str, Any]:
        item_id = str(uuid4())
        job_id = str(uuid4())
        candidate_version = str(uuid4())
        now = time.time()
        with self.transaction() as connection:
            connection.execute(
                "INSERT INTO items(id, owner, kind, title, source_url, filename, "
                "original_path, state, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'accepted', ?, ?)",
                (item_id, OWNER, kind, title, source_url, filename, original_path, now, now),
            )
            connection.execute(
                "INSERT INTO jobs(id, item_id, candidate_version, state, created_at, updated_at) "
                "VALUES (?, ?, ?, 'accepted', ?, ?)",
                (job_id, item_id, candidate_version, now, now),
            )
            row = connection.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
            return summary(row)

    def list_items(self, owner: str = OWNER) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM items WHERE owner = ? ORDER BY created_at DESC, id DESC",
                (owner,),
            ).fetchall()
            return [summary(row) for row in rows]

    def get_item(self, item_id: str, owner: str = OWNER) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM items WHERE id = ? AND owner = ?", (item_id, owner)
            ).fetchone()
            return dict(row) if row else None

    def get_job(self, job_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT j.*, i.owner, i.kind, i.source_url, i.filename, i.original_path "
                "FROM jobs j JOIN items i ON i.id = j.item_id WHERE j.id = ?",
                (job_id,),
            ).fetchone()
            return dict(row) if row else None

    def get_item_job(self, item_id: str, owner: str = OWNER) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT j.*, i.owner, i.kind, i.source_url, i.filename, i.original_path "
                "FROM jobs j JOIN items i ON i.id = j.item_id "
                "WHERE j.item_id = ? AND i.owner = ?",
                (item_id, owner),
            ).fetchone()
            return dict(row) if row else None

    def claim_job(self, worker_id: str, lease_seconds: float) -> dict[str, Any] | None:
        now = time.time()
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT j.id FROM jobs j JOIN items i ON i.id = j.item_id "
                "WHERE j.state = 'accepted' "
                "OR (j.state = 'preparing' AND j.lease_expires_at <= ?) "
                "ORDER BY j.created_at, j.id LIMIT 1",
                (now,),
            ).fetchone()
            if row is None:
                return None
            job_id = row["id"]
            connection.execute(
                "UPDATE jobs SET state = 'preparing', error = NULL, lease_owner = ?, "
                "lease_expires_at = ?, attempt = attempt + 1, updated_at = ? WHERE id = ?",
                (worker_id, now + lease_seconds, now, job_id),
            )
            connection.execute(
                "UPDATE items SET state = 'preparing', error = NULL, updated_at = ? "
                "WHERE id = (SELECT item_id FROM jobs WHERE id = ?)",
                (now, job_id),
            )
            claimed = connection.execute(
                "SELECT j.*, i.owner, i.kind, i.source_url, i.filename, i.original_path "
                "FROM jobs j JOIN items i ON i.id = j.item_id WHERE j.id = ?",
                (job_id,),
            ).fetchone()
            return dict(claimed)

    def renew_lease(self, job_id: str, worker_id: str, lease_seconds: float) -> bool:
        now = time.time()
        with self.transaction() as connection:
            cursor = connection.execute(
                "UPDATE jobs SET lease_expires_at = ?, updated_at = ? "
                "WHERE id = ? AND lease_owner = ? AND state = 'preparing'",
                (now + lease_seconds, now, job_id, worker_id),
            )
            return cursor.rowcount == 1

    def save_source(
        self,
        *,
        job_id: str,
        worker_id: str,
        title: str,
        paragraph_count: int,
        input_hash: str,
        artifact_path: str,
        metadata: dict[str, Any],
    ) -> bool:
        now = time.time()
        with self.transaction() as connection:
            cursor = connection.execute(
                "UPDATE items SET title = ?, paragraph_count = ?, updated_at = ? "
                "WHERE id = (SELECT item_id FROM jobs WHERE id = ? AND lease_owner = ? "
                "AND state = 'preparing')",
                (title, paragraph_count, now, job_id, worker_id),
            )
            if cursor.rowcount != 1:
                return False
            connection.execute(
                "INSERT INTO job_stages(job_id, stage, input_hash, artifact_path, metadata_json, updated_at) "
                "VALUES (?, 'source', ?, ?, ?, ?) "
                "ON CONFLICT(job_id, stage) DO UPDATE SET input_hash = excluded.input_hash, "
                "artifact_path = excluded.artifact_path, metadata_json = excluded.metadata_json, "
                "updated_at = excluded.updated_at",
                (job_id, input_hash, artifact_path, json.dumps(metadata, sort_keys=True), now),
            )
            return True

    def save_stage(
        self,
        *,
        job_id: str,
        worker_id: str,
        stage: str,
        input_hash: str,
        artifact_path: str,
        metadata: dict[str, Any],
    ) -> bool:
        with self.transaction() as connection:
            owner = connection.execute(
                "SELECT 1 FROM jobs WHERE id = ? AND lease_owner = ? AND state = 'preparing'",
                (job_id, worker_id),
            ).fetchone()
            if owner is None:
                return False
            connection.execute(
                "INSERT INTO job_stages(job_id, stage, input_hash, artifact_path, metadata_json, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(job_id, stage) DO UPDATE SET "
                "input_hash = excluded.input_hash, artifact_path = excluded.artifact_path, "
                "metadata_json = excluded.metadata_json, updated_at = excluded.updated_at",
                (
                    job_id,
                    stage,
                    input_hash,
                    artifact_path,
                    json.dumps(metadata, sort_keys=True),
                    time.time(),
                ),
            )
            return True

    def get_stage(self, job_id: str, stage: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM job_stages WHERE job_id = ? AND stage = ?", (job_id, stage)
            ).fetchone()
            if row is None:
                return None
            result = dict(row)
            result["metadata"] = json.loads(result.pop("metadata_json"))
            return result

    def begin_item_deletion(
        self, item_id: str, owner: str = OWNER
    ) -> tuple[str, dict[str, Any] | None]:
        now = time.time()
        with self.transaction() as connection:
            item = connection.execute(
                "SELECT * FROM items WHERE id = ? AND owner = ?", (item_id, owner)
            ).fetchone()
            if item is None:
                receipt = connection.execute(
                    "SELECT * FROM item_deletions WHERE item_id = ? AND owner = ?",
                    (item_id, owner),
                ).fetchone()
                if receipt is None:
                    return "missing", None
                return "existing", _deletion_receipt(receipt)
            job = connection.execute(
                "SELECT candidate_version FROM jobs WHERE item_id = ?", (item_id,)
            ).fetchone()
            if job is None:
                raise RuntimeError("item has no preparation job")
            published = connection.execute(
                "SELECT root_path FROM versions WHERE item_id = ? AND owner = ? "
                "ORDER BY created_at, id",
                (item_id, owner),
            ).fetchall()
            candidate_version = job["candidate_version"]
            published_paths = [row["root_path"] for row in published]
            connection.execute(
                "INSERT INTO item_deletions(item_id, owner, original_path, work_path, "
                "staging_path, candidate_path, published_paths_json, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    item_id,
                    owner,
                    item["original_path"],
                    f"work/{candidate_version}",
                    f"staging/{candidate_version}",
                    f"versions/{candidate_version}",
                    json.dumps(published_paths),
                    now,
                ),
            )
            connection.execute(
                "DELETE FROM items WHERE id = ? AND owner = ?", (item_id, owner)
            )
            receipt = connection.execute(
                "SELECT * FROM item_deletions WHERE item_id = ?", (item_id,)
            ).fetchone()
            return "deleted", _deletion_receipt(receipt)

    def get_item_deletion(
        self, item_id: str, owner: str = OWNER
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM item_deletions WHERE item_id = ? AND owner = ?",
                (item_id, owner),
            ).fetchone()
            return _deletion_receipt(row) if row else None

    def complete_item_deletion(self, item_id: str, owner: str = OWNER) -> None:
        with self.transaction() as connection:
            connection.execute(
                "UPDATE item_deletions SET completed_at = ? WHERE item_id = ? AND owner = ?",
                (time.time(), item_id, owner),
            )

    def retry(self, item_id: str, owner: str = OWNER) -> tuple[str, dict[str, Any] | None]:
        now = time.time()
        with self.transaction() as connection:
            row = connection.execute(
                "SELECT * FROM items WHERE id = ? AND owner = ?", (item_id, owner)
            ).fetchone()
            if row is None:
                return "missing", None
            if row["state"] != "failed":
                return "conflict", None
            connection.execute(
                "UPDATE jobs SET state = 'accepted', error = NULL, lease_owner = NULL, "
                "lease_expires_at = NULL, updated_at = ? WHERE item_id = ?",
                (now, item_id),
            )
            connection.execute(
                "UPDATE items SET state = 'accepted', error = NULL, updated_at = ? WHERE id = ?",
                (now, item_id),
            )
            updated = connection.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
            return "ok", summary(updated)

    def fail_job(self, job_id: str, worker_id: str, error: str) -> bool:
        now = time.time()
        with self.transaction() as connection:
            cursor = connection.execute(
                "UPDATE jobs SET state = 'failed', error = ?, lease_owner = NULL, "
                "lease_expires_at = NULL, updated_at = ? "
                "WHERE id = ? AND lease_owner = ? AND state = 'preparing'",
                (error, now, job_id, worker_id),
            )
            if cursor.rowcount != 1:
                return False
            connection.execute(
                "UPDATE items SET state = 'failed', error = ?, updated_at = ? "
                "WHERE id = (SELECT item_id FROM jobs WHERE id = ?)",
                (error, now, job_id),
            )
            return True

    def publish_version(
        self,
        *,
        job_id: str,
        worker_id: str,
        version: str,
        root_path: str,
        manifest_path: str,
        text_sha256: str,
        audio_sha256: str,
        timings_sha256: str,
        duration: float,
        paragraph_count: int,
    ) -> bool:
        now = time.time()
        with self.transaction() as connection:
            job = connection.execute(
                "SELECT * FROM jobs WHERE id = ? AND lease_owner = ? AND state = 'preparing'",
                (job_id, worker_id),
            ).fetchone()
            if job is None or job["candidate_version"] != version:
                return False
            item = connection.execute(
                "SELECT owner FROM items WHERE id = ?", (job["item_id"],)
            ).fetchone()
            connection.execute(
                "INSERT INTO versions(id, item_id, owner, root_path, manifest_path, "
                "text_sha256, audio_sha256, timings_sha256, duration, paragraph_count, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    version,
                    job["item_id"],
                    item["owner"],
                    root_path,
                    manifest_path,
                    text_sha256,
                    audio_sha256,
                    timings_sha256,
                    duration,
                    paragraph_count,
                    now,
                ),
            )
            connection.execute(
                "UPDATE items SET state = 'ready', error = NULL, published_version = ?, "
                "paragraph_count = ?, updated_at = ? WHERE id = ?",
                (version, paragraph_count, now, job["item_id"]),
            )
            connection.execute(
                "UPDATE jobs SET state = 'ready', error = NULL, lease_owner = NULL, "
                "lease_expires_at = NULL, updated_at = ? WHERE id = ?",
                (now, job_id),
            )
            return True

    def get_ready_version(
        self, item_id: str, version: str, owner: str = OWNER
    ) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT v.* FROM versions v JOIN items i ON i.id = v.item_id "
                "WHERE v.id = ? AND v.item_id = ? AND v.owner = ? AND i.owner = ?",
                (version, item_id, owner, owner),
            ).fetchone()
            return dict(row) if row else None


__all__ = ["Database", "OWNER", "summary"]
