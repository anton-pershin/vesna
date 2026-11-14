"""Item-deletion receipts, strict cleanup, API outcomes, and concurrency."""

from __future__ import annotations

from contextlib import contextmanager
import json
from pathlib import Path
import sqlite3
import threading
from uuid import uuid4

from fastapi.testclient import TestClient
import pytest

from conftest import ORIGIN, FakeTts, sign_in, submit_markdown
from vesna.api import create_app
from vesna.artifacts import ArtifactError
from vesna.worker import Worker


def delete_item(client: TestClient, item_id: str):
    return client.delete(f"/api/items/{item_id}", headers={"Origin": ORIGIN})


def deletion_row(database, item_id: str) -> sqlite3.Row:
    with database.connect() as connection:
        row = connection.execute(
            "SELECT * FROM item_deletions WHERE item_id = ?", (item_id,)
        ).fetchone()
    assert row is not None
    return row


def candidate_roots(database, item_id: str) -> tuple[str, str, str]:
    job = database.get_item_job(item_id)
    assert job is not None
    version = job["candidate_version"]
    return f"work/{version}", f"staging/{version}", f"versions/{version}"


def make_other_item(client, database, store) -> tuple[dict, str, str]:
    other = submit_markdown(client, b"Other item must remain.", "other.md")
    original_path = database.get_item(other["id"])["original_path"]
    job = database.get_item_job(other["id"])
    marker = f"work/{job['candidate_version']}/other-item.txt"
    store.write_bytes(marker, b"other item artifact")
    return other, original_path, marker


def assert_other_item_unchanged(client, database, store, other, original_path, marker):
    assert database.get_item(other["id"]) is not None
    assert store.read_bytes(original_path) == b"Other item must remain."
    assert store.read_bytes(marker) == b"other item artifact"
    assert client.get(f"/api/items/{other['id']}").status_code == 200


@pytest.mark.parametrize("state", ["accepted", "preparing", "ready", "failed"])
def test_delete_every_state_removes_item_artifacts_and_preserves_other_item(
    client, database, store, settings, worker_factory, state
):
    sign_in(client)
    item = submit_markdown(client, b"Target.")
    if state == "preparing":
        assert database.claim_job("preparing-fixture", 60)["item_id"] == item["id"]
    elif state == "ready":
        assert worker_factory().run_once()
    elif state == "failed":
        assert Worker(
            settings,
            database,
            store,
            tts_client=FakeTts(fail_once_on="Target."),
        ).run_once()
    assert database.get_item(item["id"])["state"] == state

    original_path = database.get_item(item["id"])["original_path"]
    published_version = database.get_item(item["id"])["published_version"]
    roots = candidate_roots(database, item["id"])
    for root in roots:
        store.write_bytes(f"{root}/deletion-fixture", b"must be removed")
    other, other_original, other_marker = make_other_item(client, database, store)

    response = delete_item(client, item["id"])
    assert response.status_code == 204, response.text
    assert response.content == b""
    assert response.headers["cache-control"] == "no-store"
    assert delete_item(client, item["id"]).status_code == 204

    assert database.get_item(item["id"]) is None
    assert not store.path(original_path).exists()
    for root in roots:
        assert not store.path(root).exists()
    receipt = deletion_row(database, item["id"])
    assert receipt["owner"] == "local-user"
    assert receipt["completed_at"] is not None
    assert receipt["created_at"] <= receipt["completed_at"]
    assert_other_item_unchanged(
        client, database, store, other, other_original, other_marker
    )
    assert [entry["id"] for entry in client.get("/api/items").json()["items"]] == [
        other["id"]
    ]

    assert client.get(f"/api/items/{item['id']}").status_code == 404
    assert client.get(f"/api/items/{item['id']}/source").status_code == 404
    if published_version:
        base = f"/api/items/{item['id']}/versions/{published_version}"
        assert client.get(f"{base}/text").status_code == 404
        assert client.get(f"{base}/timings").status_code == 404
        assert client.get(f"{base}/audio").status_code == 404

    lock_files = list(store.path("locks").iterdir())
    assert len(lock_files) == 1
    assert lock_files[0].stat().st_mode & 0o777 == 0o600


def test_receipt_records_candidate_and_every_published_root_without_user_content(
    client, database, store, worker_factory
):
    sign_in(client)
    item = submit_markdown(client, b"Private listening text.", "private-name.md")
    assert worker_factory().run_once()
    ready = database.get_item(item["id"])
    current_version = ready["published_version"]
    historical_version = str(uuid4())
    historical_root = f"versions/{historical_version}"
    for filename in ("manifest.json", "text.json", "timings.json", "audio.mp3"):
        store.write_bytes(f"{historical_root}/{filename}", b"historical fixture")
    with database.transaction() as connection:
        connection.execute(
            "INSERT INTO versions(id, item_id, owner, root_path, manifest_path, "
            "text_sha256, audio_sha256, timings_sha256, duration, paragraph_count, created_at) "
            "VALUES (?, ?, 'local-user', ?, ?, 'text', 'audio', 'timings', 1, 1, 1)",
            (
                historical_version,
                item["id"],
                historical_root,
                f"{historical_root}/manifest.json",
            ),
        )

    assert delete_item(client, item["id"]).status_code == 204
    receipt = deletion_row(database, item["id"])
    assert set(receipt.keys()) == {
        "item_id",
        "owner",
        "original_path",
        "work_path",
        "staging_path",
        "candidate_path",
        "published_paths_json",
        "created_at",
        "completed_at",
    }
    assert receipt["original_path"] == ready["original_path"]
    assert receipt["work_path"] == f"work/{current_version}"
    assert receipt["staging_path"] == f"staging/{current_version}"
    assert receipt["candidate_path"] == f"versions/{current_version}"
    assert set(json.loads(receipt["published_paths_json"])) == {
        f"versions/{current_version}",
        historical_root,
    }
    assert not store.path(historical_root).exists()
    assert not store.path(f"versions/{current_version}").exists()
    serialized = repr(tuple(receipt))
    assert "Private listening text." not in serialized
    assert "private-name.md" not in serialized


def test_unknown_item_and_receipt_get_404(client, database):
    sign_in(client)
    unknown = str(uuid4())
    response = delete_item(client, unknown)
    assert response.status_code == 404
    assert response.json() == {"detail": "Item not found."}
    with database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM item_deletions").fetchone()[0] == 0


def test_precommit_failure_rolls_back_item_and_receipt_with_sanitized_500(
    client, database, store, monkeypatch
):
    sign_in(client)
    item = submit_markdown(client, b"Must survive rollback.")
    before = database.get_item(item["id"])
    original_transaction = database.transaction

    @contextmanager
    def fail_before_commit():
        with original_transaction() as connection:
            yield connection
            raise RuntimeError("private transaction detail")

    monkeypatch.setattr(database, "transaction", fail_before_commit)
    response = delete_item(client, item["id"])
    monkeypatch.setattr(database, "transaction", original_transaction)

    assert response.status_code == 500
    assert response.json() == {"detail": "Item deletion could not be started; retry."}
    assert "private" not in response.text
    assert database.get_item(item["id"]) == before
    assert store.path(before["original_path"]).is_file()
    with database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM item_deletions").fetchone()[0] == 0


@pytest.mark.parametrize("failure_point", ["cleanup", "receipt_completion"])
def test_postcommit_failure_gets_503_then_resumes_to_204(
    client, database, store, monkeypatch, failure_point
):
    sign_in(client)
    item = submit_markdown(client, b"Cleanup retry.")
    original_path = database.get_item(item["id"])["original_path"]
    roots = candidate_roots(database, item["id"])
    other, other_original, other_marker = make_other_item(client, database, store)

    if failure_point == "cleanup":
        original = store.remove_tree_strict

        def fail_cleanup(relative):
            raise ArtifactError("private filesystem detail")

        monkeypatch.setattr(store, "remove_tree_strict", fail_cleanup)
    else:
        original = database.complete_item_deletion

        def fail_completion(item_id, owner):
            raise RuntimeError("private completion detail")

        monkeypatch.setattr(database, "complete_item_deletion", fail_completion)

    response = delete_item(client, item["id"])
    if failure_point == "cleanup":
        monkeypatch.setattr(store, "remove_tree_strict", original)
    else:
        monkeypatch.setattr(database, "complete_item_deletion", original)

    assert response.status_code == 503
    assert response.json() == {"detail": "Item deletion is incomplete; retry cleanup."}
    assert "private" not in response.text
    assert database.get_item(item["id"]) is None
    assert deletion_row(database, item["id"])["completed_at"] is None
    assert_other_item_unchanged(
        client, database, store, other, other_original, other_marker
    )

    assert delete_item(client, item["id"]).status_code == 204
    assert delete_item(client, item["id"]).status_code == 204
    assert deletion_row(database, item["id"])["completed_at"] is not None
    assert not store.path(original_path).exists()
    for root in roots:
        assert not store.path(root).exists()
    assert_other_item_unchanged(
        client, database, store, other, other_original, other_marker
    )


def test_delete_requires_authentication_and_strict_origin(client, database):
    item = database.create_item(kind="article", source_url="https://example.test/article")
    response = delete_item(client, item["id"])
    assert response.status_code == 401
    assert database.get_item(item["id"]) is not None

    sign_in(client)
    for headers in (
        {},
        {"Origin": "https://attacker.test"},
        {"Origin": "null"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "cross-site"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "same-site"},
    ):
        response = client.delete(f"/api/items/{item['id']}", headers=headers)
        assert response.status_code == 403
        assert database.get_item(item["id"]) is not None
    with database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM item_deletions").fetchone()[0] == 0


def test_other_owner_item_and_receipt_are_unknown(client, database):
    sign_in(client)
    other_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            "INSERT INTO items(id, owner, kind, state, created_at, updated_at) "
            "VALUES (?, 'someone-else', 'article', 'accepted', 1, 1)",
            (other_id,),
        )
    assert delete_item(client, other_id).status_code == 404
    with database.connect() as connection:
        assert connection.execute(
            "SELECT count(*) FROM items WHERE id = ?", (other_id,)
        ).fetchone()[0] == 1
        assert connection.execute("SELECT count(*) FROM item_deletions").fetchone()[0] == 0


def test_concurrent_duplicate_deletes_are_both_safe_204(
    client, database, store, settings, monkeypatch
):
    token = sign_in(client)
    item = submit_markdown(client, b"Concurrent deletion.")
    other, other_original, other_marker = make_other_item(client, database, store)
    barrier = threading.Barrier(2)
    original_begin = database.begin_item_deletion

    def synchronized_begin(*args, **kwargs):
        barrier.wait(timeout=10)
        return original_begin(*args, **kwargs)

    monkeypatch.setattr(database, "begin_item_deletion", synchronized_begin)
    with TestClient(
        create_app(settings, database=database, store=store), base_url=ORIGIN
    ) as second_client:
        second_client.cookies.set("vesna_session", token, domain="app.test", path="/")
        responses = [None, None]
        errors = []

        def request(index, request_client):
            try:
                responses[index] = delete_item(request_client, item["id"])
            except BaseException as error:
                errors.append(error)

        threads = [
            threading.Thread(target=request, args=(0, client)),
            threading.Thread(target=request, args=(1, second_client)),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            assert not thread.is_alive()
        assert errors == []

    assert [response.status_code for response in responses] == [204, 204]
    assert database.get_item(item["id"]) is None
    assert deletion_row(database, item["id"])["completed_at"] is not None
    assert_other_item_unchanged(
        client, database, store, other, other_original, other_marker
    )


def test_lost_first_response_can_be_retried_without_a_request_token(
    client, database, store
):
    sign_in(client)
    item = submit_markdown(client, b"Lost response.")
    original_path = database.get_item(item["id"])["original_path"]

    # The server cannot distinguish a discarded response from a network loss.
    lost_response = delete_item(client, item["id"])
    assert lost_response.status_code == 204
    del lost_response
    resumed = delete_item(client, item["id"])

    assert resumed.status_code == 204
    assert database.get_item(item["id"]) is None
    assert not store.path(original_path).exists()
    assert deletion_row(database, item["id"])["completed_at"] is not None


def test_strict_artifact_removal_is_missing_aware_and_does_not_change_best_effort(
    store
):
    store.remove_file_strict("sources/missing/original.md")
    store.remove_tree_strict("work/missing")
    store.write_bytes("sources/not-a-directory/original.md", b"fixture")
    with pytest.raises(ArtifactError):
        store.remove_file_strict("sources/not-a-directory")
    store.write_bytes("work/not-a-tree", b"fixture")
    with pytest.raises(ArtifactError):
        store.remove_tree_strict("work/not-a-tree")
    with pytest.raises(ArtifactError):
        store.remove_tree_strict("work")

    # Existing best-effort behavior remains unchanged for preparation cleanup.
    store.remove_tree("work/not-a-tree")
    assert store.path("work/not-a-tree").exists()
    store.remove("work/not-a-tree")
    assert not store.path("work/not-a-tree").exists()
    store.remove("sources/not-a-directory")
    assert store.path("sources/not-a-directory").exists()
