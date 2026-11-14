"""Public build identity and static-shell update headers."""

from __future__ import annotations

from dataclasses import replace
from pathlib import Path

from fastapi.testclient import TestClient

from conftest import ORIGIN
from vesna.api import create_app


def test_build_identity_is_public_and_contains_no_credentials(settings, database, store):
    configured = replace(settings, build_commit="c07b026-test-build")
    with TestClient(create_app(configured, database=database, store=store), base_url=ORIGIN) as client:
        response = client.get("/api/build")
    assert response.status_code == 200
    assert response.json() == {"commit": "c07b026-test-build"}
    assert response.headers["cache-control"] == "no-store"


def test_static_shell_resources_require_revalidation(settings, database, store):
    public = Path(__file__).parents[2] / "public"
    configured = replace(settings, static_dir=public)
    with TestClient(create_app(configured, database=database, store=store), base_url=ORIGIN) as client:
        for resource in ("/", "/app.js", "/sw.js", "/styles.css", "/modules/player.js"):
            response = client.get(resource)
            assert response.status_code == 200, resource
            assert response.headers["cache-control"] == "no-cache", resource
