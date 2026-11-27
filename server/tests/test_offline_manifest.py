"""Authenticated prepared-version manifests for offline integrity checks."""

from __future__ import annotations

import hashlib
from uuid import uuid4

import pytest

from conftest import sign_in, submit_markdown


def prepare_markdown(client, database, worker_factory) -> tuple[str, str]:
    sign_in(client)
    item = submit_markdown(client, b"# Offline heading\n\nA prepared paragraph.")
    assert worker_factory().run_once() is True
    ready = database.get_item(item["id"])
    assert ready is not None and ready["state"] == "ready"
    return item["id"], ready["published_version"]


def manifest_url(item_id: str, version: str) -> str:
    return f"/api/items/{item_id}/versions/{version}/manifest"


def test_manifest_requires_authentication(client):
    response = client.get(manifest_url(str(uuid4()), str(uuid4())))
    assert response.status_code == 401
    assert response.json() == {"detail": "Authentication required."}


def test_prepared_markdown_manifest_matches_raw_artifact_hashes(
    client, database, store, worker_factory
):
    item_id, version = prepare_markdown(client, database, worker_factory)
    response = client.get(manifest_url(item_id, version))

    assert response.status_code == 200
    manifest = response.json()
    assert manifest == store.read_json(f"versions/{version}/manifest.json")
    assert manifest["item_id"] == item_id
    assert manifest["version"] == version
    assert "root_path" not in manifest
    assert "manifest_path" not in manifest
    assert str(store.root) not in response.text

    record = database.get_ready_version(item_id, version)
    assert record is not None
    for filename, key in (
        ("text.json", "text_sha256"),
        ("audio.mp3", "audio_sha256"),
        ("timings.json", "timings_sha256"),
    ):
        digest = hashlib.sha256(store.read_bytes(f"versions/{version}/{filename}")).hexdigest()
        assert manifest[key] == digest
        assert record[key] == digest

    for filename, kind in (("text.json", "text"), ("timings.json", "timings")):
        response = client.get(f"/api/items/{item_id}/versions/{version}/{kind}")
        assert response.status_code == 200
        assert response.content == store.read_bytes(f"versions/{version}/{filename}")


def test_unknown_and_unready_versions_are_not_found(client, database):
    sign_in(client)
    item = submit_markdown(client)
    candidate = database.get_item_job(item["id"])["candidate_version"]

    assert client.get(manifest_url(item["id"], candidate)).status_code == 404
    assert client.get(manifest_url(item["id"], str(uuid4()))).status_code == 404
    assert client.get(manifest_url(str(uuid4()), candidate)).status_code == 404


@pytest.mark.parametrize("filename", ["text.json", "audio.mp3", "timings.json"])
def test_tampered_artifacts_make_manifest_unavailable(
    client, database, store, worker_factory, filename
):
    item_id, version = prepare_markdown(client, database, worker_factory)
    relative = f"versions/{version}/{filename}"
    store.write_bytes(relative, store.read_bytes(relative) + b"tampered")

    response = client.get(manifest_url(item_id, version))
    assert response.status_code == 409
    assert response.json() == {"detail": "Prepared version is unavailable."}
    assert str(store.root) not in response.text


def test_manifest_hash_must_match_database_and_raw_artifact(
    client, database, store, worker_factory
):
    item_id, version = prepare_markdown(client, database, worker_factory)
    manifest_path = f"versions/{version}/manifest.json"
    manifest = store.read_json(manifest_path)
    manifest["audio_sha256"] = "0" * 64
    store.write_json(manifest_path, manifest)

    response = client.get(manifest_url(item_id, version))
    assert response.status_code == 409
    assert response.json() == {"detail": "Prepared version is unavailable."}
