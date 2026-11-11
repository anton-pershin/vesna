"""Controlled fixtures for deterministic server tests; no external services."""

from __future__ import annotations

import io
from pathlib import Path
import struct
import threading
import time
import wave

from comourat.models import ArticleResult
from fastapi.testclient import TestClient
import pytest

from vesna.api import create_app
from vesna.artifacts import ArtifactStore
from vesna.auth import hash_password
from vesna.config import Settings
from vesna.db import Database
from vesna.worker import Worker

PASSWORD = "deterministic-test-password"
ORIGIN = "https://app.test"


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_path=tmp_path / "vesna.sqlite3",
        artifact_root=tmp_path / "artifacts",
        public_origin=ORIGIN,
        password_hash=hash_password(PASSWORD, salt=b"0123456789abcdef"),
        static_dir=tmp_path / "no-static",
        worker_poll_seconds=0.01,
    )


@pytest.fixture
def database(settings: Settings) -> Database:
    return Database(settings.database_path)


@pytest.fixture
def store(settings: Settings) -> ArtifactStore:
    return ArtifactStore(settings.artifact_root)


@pytest.fixture
def client(settings: Settings, database: Database, store: ArtifactStore):
    with TestClient(
        create_app(settings, database=database, store=store), base_url=ORIGIN
    ) as test_client:
        yield test_client


@pytest.fixture
def origin_headers() -> dict[str, str]:
    return {"Origin": ORIGIN}


def sign_in(client: TestClient) -> str:
    response = client.post(
        "/api/auth/sign-in", json={"password": PASSWORD}, headers={"Origin": ORIGIN}
    )
    assert response.status_code == 204
    return response.cookies["vesna_session"]


def submit_markdown(
    client: TestClient,
    content: bytes = b"First paragraph.\n\nSecond paragraph.",
    filename: str = "document.md",
) -> dict:
    response = client.post(
        "/api/items/markdown",
        files={"file": (filename, content, "text/markdown")},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 202, response.text
    return response.json()


def make_wav(duration: float = 0.16, *, channels: int = 1) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(channels)
        wav.setsampwidth(2)
        wav.setframerate(24000)
        frame_count = max(1, round(duration * 24000))
        wav.writeframes(struct.pack("<h", 1000) * channels * frame_count)
    return output.getvalue()


class FakeTts:
    def __init__(self, *, fail_once_on: str | None = None, delay: float = 0.0) -> None:
        self.calls: list[str] = []
        self.fail_once_on = fail_once_on
        self.delay = delay
        self.failed = False
        self.active = 0
        self.max_active = 0
        self.lock = threading.Lock()

    def synthesize(self, text: str) -> bytes:
        with self.lock:
            self.calls.append(text)
            self.active += 1
            self.max_active = max(self.max_active, self.active)
        try:
            if self.delay:
                time.sleep(self.delay)
            if self.fail_once_on == text and not self.failed:
                self.failed = True
                raise RuntimeError("private tts URL and sensitive provider detail")
            return make_wav(0.12 + len(self.calls) * 0.02)
        finally:
            with self.lock:
                self.active -= 1


class FakeArticle:
    def __init__(self, outcomes=None) -> None:
        self.outcomes = list(
            outcomes
            if outcomes is not None
            else [ArticleResult(title="Fixture article", source_url="https://example.test/final", text="Article one.\n\nArticle two.")]
        )
        self.calls: list[str] = []

    def fetch_article(self, url: str):
        self.calls.append(url)
        outcome = self.outcomes.pop(0) if len(self.outcomes) > 1 else self.outcomes[0]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome


@pytest.fixture
def worker_factory(settings: Settings, database: Database, store: ArtifactStore):
    def make(**overrides) -> Worker:
        overrides.setdefault("tts_client", FakeTts())
        return Worker(settings, database, store, **overrides)

    return make
