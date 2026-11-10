"""Durable state, restart recovery, saved-stage reuse, retries, and claims."""

from __future__ import annotations

from dataclasses import replace
import threading

from comourat.models import ArticleResult
from fastapi.testclient import TestClient
import pytest

from conftest import (
    ORIGIN,
    FakeArticle,
    FakeTts,
    make_wav,
    sign_in,
    submit_markdown,
)
from vesna.api import create_app
from vesna.artifacts import ArtifactStore
from vesna.audio import AssemblyError, AudioAssembler
from vesna.db import Database
from vesna.worker import Worker


def test_accepted_preparing_ready_transitions_and_source_visibility(
    client, database, store, settings, worker_factory
):
    sign_in(client)
    item = submit_markdown(client)
    assert item["state"] == "accepted"
    claim = database.claim_job("test-claim", 60)
    assert database.get_item(item["id"])["state"] == "preparing"
    worker = worker_factory()
    source = worker._source(claim, "test-claim")
    detail = client.get(f"/api/items/{item['id']}").json()
    assert detail["item"]["state"] == "preparing"
    assert detail["paragraphs"] == source["paragraphs"]
    worker._process(claim, "test-claim")
    ready = client.get(f"/api/items/{item['id']}").json()
    assert ready["item"]["state"] == "ready"
    assert ready["item"]["version"] == claim["candidate_version"]
    assert ready["item"]["paragraph_count"] == 2


def test_accepted_job_and_session_survive_api_and_worker_recreation(
    client, database, store, settings
):
    token = sign_in(client)
    item = submit_markdown(client)
    recreated_database = Database(settings.database_path)
    recreated_store = ArtifactStore(settings.artifact_root)
    with TestClient(
        create_app(settings, database=recreated_database, store=recreated_store),
        base_url=ORIGIN,
    ) as recreated_client:
        recreated_client.cookies.set("vesna_session", token, domain="app.test", path="/")
        assert recreated_client.get("/api/auth/session").status_code == 200
        assert recreated_client.get("/api/items").json()["items"][0]["id"] == item["id"]
    Worker(settings, recreated_database, recreated_store, tts_client=FakeTts()).run_once()
    assert recreated_database.get_item(item["id"])["state"] == "ready"


def test_article_failure_retry_keeps_item_and_replaces_no_source(
    client, database, store, settings
):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/story"},
        headers={"Origin": ORIGIN},
    )
    item = response.json()
    article = FakeArticle(
        [
            RuntimeError("secret provider response and private endpoint"),
            ArticleResult(
                title="Recovered",
                source_url="https://example.test/story",
                text="One.\n\nTwo.",
            ),
        ]
    )
    tts = FakeTts()
    worker = Worker(settings, database, store, article_adapter=article, tts_client=tts)
    worker.run_once()
    failed = database.get_item(item["id"])
    assert failed["state"] == "failed"
    assert failed["published_version"] is None
    assert "secret" not in failed["error"] and "endpoint" not in failed["error"]
    retry = client.post(f"/api/items/{item['id']}/retry", headers={"Origin": ORIGIN})
    assert retry.status_code == 202
    assert retry.json()["id"] == item["id"]
    worker.run_once()
    assert database.get_item(item["id"])["state"] == "ready"
    assert article.calls == ["https://example.test/story"] * 2
    assert len(database.list_items()) == 1


def test_tts_failure_retry_reuses_valid_prior_paragraphs(client, database, store, settings):
    sign_in(client)
    item = submit_markdown(client, b"First.\n\nSecond.\n\nThird.")
    tts = FakeTts(fail_once_on="Second.")
    worker = Worker(settings, database, store, tts_client=tts)
    worker.run_once()
    assert database.get_item(item["id"])["state"] == "failed"
    assert tts.calls == ["First.", "Second."]
    assert client.post(
        f"/api/items/{item['id']}/retry", headers={"Origin": ORIGIN}
    ).status_code == 202
    worker.run_once()
    assert database.get_item(item["id"])["state"] == "ready"
    assert tts.calls == ["First.", "Second.", "Second.", "Third."]
    assert tts.max_active == 1


def test_assembly_failure_preserves_all_speech_for_retry(client, database, store, settings):
    sign_in(client)
    item = submit_markdown(client)

    class BrokenAssembler:
        def assemble(self, **kwargs):
            raise AssemblyError("private assembly path")

    tts = FakeTts()
    Worker(settings, database, store, tts_client=tts, assembler=BrokenAssembler()).run_once()
    failed = database.get_item(item["id"])
    assert failed["state"] == "failed"
    assert failed["published_version"] is None
    with database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM versions").fetchone()[0] == 0
    client.post(f"/api/items/{item['id']}/retry", headers={"Origin": ORIGIN})
    Worker(settings, database, store, tts_client=tts).run_once()
    assert database.get_item(item["id"])["state"] == "ready"
    assert tts.calls == ["First paragraph.", "Second paragraph."]


def test_interrupted_worker_recovers_expired_lease_and_reuses_saved_stages(
    client, database, store, settings
):
    sign_in(client)
    item = submit_markdown(client)

    class InterruptedAssembler:
        def assemble(self, **kwargs):
            raise KeyboardInterrupt()

    tts = FakeTts()
    with pytest.raises(KeyboardInterrupt):
        Worker(
            settings, database, store, tts_client=tts, assembler=InterruptedAssembler()
        ).run_once()
    assert database.get_item(item["id"])["state"] == "preparing"
    with database.transaction() as connection:
        connection.execute("UPDATE jobs SET lease_expires_at = 0")
    Worker(settings, database, store, tts_client=tts).run_once()
    assert database.get_item(item["id"])["state"] == "ready"
    assert tts.calls == ["First paragraph.", "Second paragraph."]


def test_article_retry_reuses_saved_source_without_refetch(client, database, store, settings):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/source-once"},
        headers={"Origin": ORIGIN},
    )
    item_id = response.json()["id"]
    adapter = FakeArticle()
    tts = FakeTts(fail_once_on="Article two.")
    worker = Worker(settings, database, store, article_adapter=adapter, tts_client=tts)
    worker.run_once()
    assert database.get_item(item_id)["state"] == "failed"
    client.post(f"/api/items/{item_id}/retry", headers={"Origin": ORIGIN})
    worker.run_once()
    assert database.get_item(item_id)["state"] == "ready"
    assert adapter.calls == ["https://example.test/source-once"]


def test_corrupt_saved_speech_is_regenerated_not_reused(client, database, store, settings):
    sign_in(client)
    item = submit_markdown(client)

    class BrokenAssembler:
        def assemble(self, **kwargs):
            raise AssemblyError("injected")

    tts = FakeTts()
    Worker(settings, database, store, tts_client=tts, assembler=BrokenAssembler()).run_once()
    job = database.get_item_job(item["id"])
    stage = database.get_stage(job["id"], "speech:p0")
    store.write_bytes(stage["artifact_path"], make_wav())
    client.post(f"/api/items/{item['id']}/retry", headers={"Origin": ORIGIN})
    Worker(settings, database, store, tts_client=tts).run_once()
    assert tts.calls == ["First paragraph.", "Second paragraph.", "First paragraph."]


def test_changed_voice_does_not_reuse_speech_stage(client, database, store, settings):
    sign_in(client)
    item = submit_markdown(client)

    class BrokenAssembler:
        def assemble(self, **kwargs):
            raise AssemblyError("injected")

    tts = FakeTts()
    Worker(settings, database, store, tts_client=tts, assembler=BrokenAssembler()).run_once()
    client.post(f"/api/items/{item['id']}/retry", headers={"Origin": ORIGIN})
    changed = replace(settings, voice_id="another-voice")
    Worker(changed, database, store, tts_client=tts).run_once()
    assert tts.calls == [
        "First paragraph.",
        "Second paragraph.",
        "First paragraph.",
        "Second paragraph.",
    ]


def test_markdown_path_never_constructs_or_calls_article_adapter(
    client, database, store, settings
):
    sign_in(client)
    item = submit_markdown(client)

    class ForbiddenArticle:
        def fetch_article(self, url):
            raise AssertionError("Markdown path called comourat")

    Worker(
        settings,
        database,
        store,
        article_adapter=ForbiddenArticle(),
        tts_client=FakeTts(),
    ).run_once()
    assert database.get_item(item["id"])["state"] == "ready"


def test_empty_article_extraction_fails_without_ready_version(client, database, store, settings):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/empty"},
        headers={"Origin": ORIGIN},
    )
    item = response.json()
    article = FakeArticle(
        [ArticleResult(title="Empty", source_url="https://example.test/empty", text=" \n ")]
    )
    Worker(settings, database, store, article_adapter=article, tts_client=FakeTts()).run_once()
    item = database.get_item(item["id"])
    assert item["state"] == "failed"
    assert item["published_version"] is None
    assert item["paragraph_count"] == 0


def test_missing_original_upload_fails_clearly_without_ready(client, database, store, settings):
    sign_in(client)
    item = submit_markdown(client)
    store.remove(database.get_item(item["id"])["original_path"])
    Worker(settings, database, store, tts_client=FakeTts()).run_once()
    failed = database.get_item(item["id"])
    assert failed["state"] == "failed"
    assert failed["published_version"] is None


def test_concurrent_transactional_claims_execute_job_only_once(database, store, settings):
    original = store.write_bytes("sources/input/original.md", b"one")
    item = database.create_item(
        kind="markdown", filename="one.md", original_path="sources/input/original.md"
    )
    barrier = threading.Barrier(3)
    claimed = []

    def claim(name):
        local = Database(settings.database_path)
        barrier.wait()
        result = local.claim_job(name, 60)
        if result:
            claimed.append(result["id"])

    threads = [threading.Thread(target=claim, args=(f"worker-{index}",)) for index in range(2)]
    for thread in threads:
        thread.start()
    barrier.wait()
    for thread in threads:
        thread.join(timeout=5)
    assert len(claimed) == 1
    job = database.get_item_job(item["id"])
    assert job["attempt"] == 1


def test_stale_worker_cannot_fail_or_publish_after_reclaim(database):
    database.create_item(kind="article", source_url="https://example.test")
    first = database.claim_job("first", 0.01)
    with database.transaction() as connection:
        connection.execute("UPDATE jobs SET lease_expires_at = 0")
    second = database.claim_job("second", 60)
    assert second["id"] == first["id"]
    assert database.fail_job(first["id"], "first", "stale failure") is False
    assert database.get_item_job(first["item_id"])["state"] == "preparing"


def test_failed_new_attempt_does_not_damage_existing_published_version(
    client, database, store, settings
):
    sign_in(client)
    item = submit_markdown(client)
    Worker(settings, database, store, tts_client=FakeTts()).run_once()
    ready = database.get_item(item["id"])
    old_version = ready["published_version"]
    old_audio_hash = store.sha256(f"versions/{old_version}/audio.mp3")
    from uuid import uuid4

    new_candidate = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            "UPDATE jobs SET candidate_version = ?, state = 'accepted', lease_owner = NULL",
            (new_candidate,),
        )
        connection.execute("UPDATE items SET state = 'accepted' WHERE id = ?", (item["id"],))
    Worker(
        settings,
        database,
        store,
        tts_client=FakeTts(fail_once_on="First paragraph."),
    ).run_once()
    failed = database.get_item(item["id"])
    assert failed["state"] == "failed"
    assert failed["published_version"] == old_version
    assert store.sha256(f"versions/{old_version}/audio.mp3") == old_audio_hash
    audio = client.get(f"/api/items/{item['id']}/versions/{old_version}/audio")
    assert audio.status_code == 200
    assert not store.path(f"versions/{new_candidate}").exists()


def test_only_failed_items_can_retry(client):
    sign_in(client)
    item = submit_markdown(client)
    assert client.post(
        f"/api/items/{item['id']}/retry", headers={"Origin": ORIGIN}
    ).status_code == 409
