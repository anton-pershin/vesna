"""Configuration isolation, migration idempotence, and entry-point contracts."""

from __future__ import annotations

from pathlib import Path
import tomllib

import pytest

from vesna.api import create_app
from vesna.config import Settings
from vesna.db import Database


def test_only_api_requires_auth_environment(settings, monkeypatch, tmp_path):
    monkeypatch.delenv("VESNA_PUBLIC_ORIGIN", raising=False)
    monkeypatch.delenv("VESNA_PASSWORD_HASH", raising=False)
    monkeypatch.setenv("VESNA_DATABASE", str(tmp_path / "worker.sqlite3"))
    monkeypatch.setenv("VESNA_ARTIFACT_ROOT", str(tmp_path / "artifacts"))
    worker_settings = Settings.from_env()
    assert worker_settings.password_hash == ""
    with pytest.raises(ValueError, match="must be supplied externally"):
        Settings.from_env(require_auth=True)
    monkeypatch.setenv("VESNA_PUBLIC_ORIGIN", settings.public_origin)
    monkeypatch.setenv("VESNA_PASSWORD_HASH", settings.password_hash)
    assert Settings.from_env(require_auth=True).password_hash == settings.password_hash


def test_database_migrations_are_idempotent(settings):
    first = Database(settings.database_path)
    second = Database(settings.database_path)
    with second.connect() as connection:
        assert connection.execute("SELECT version FROM schema_migrations").fetchall()[0][0] == 1


def test_private_artifacts_cannot_be_mounted_as_static(settings, tmp_path):
    public = tmp_path / "public"
    public.mkdir()
    unsafe = Settings(
        database_path=settings.database_path,
        artifact_root=public / "artifacts",
        public_origin=settings.public_origin,
        password_hash=settings.password_hash,
        static_dir=public,
    )
    with pytest.raises(ValueError, match="outside"):
        create_app(unsafe)


def test_requested_console_entry_points_are_declared():
    root = Path(__file__).parents[2]
    with (root / "server" / "pyproject.toml").open("rb") as source:
        project = tomllib.load(source)
    scripts = project["project"]["scripts"]
    assert scripts["vesna-api"] == "vesna.api_main:main"
    assert scripts["vesna-worker"] == "vesna.worker_main:main"
    assert scripts["vesna-tts"] == "vesna.tts_main:main"


def test_comourat_pin_is_unchanged():
    root = Path(__file__).parents[2]
    with (root / "server" / "pyproject.toml").open("rb") as source:
        project = tomllib.load(source)
    dependencies = project["project"]["dependencies"]
    assert any("c9bfb1604a5286d073aaceef1513e0d7496d0e33" in value for value in dependencies)
