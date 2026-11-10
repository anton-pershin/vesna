"""Article/Markdown validation, inert parsing, source transparency, and limits."""

from __future__ import annotations

from dataclasses import replace
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import threading
import time

from fastapi.testclient import TestClient
import pytest

from conftest import ORIGIN, make_wav, sign_in, submit_markdown
from vesna.api import create_app
from vesna.text import plain_paragraphs


@pytest.mark.parametrize("url", ["https://example.test/article", "http://example.test/article"])
def test_valid_public_article_inputs_create_one_accepted_item(client, url):
    sign_in(client)
    response = client.post(
        "/api/items/article", json={"url": url}, headers={"Origin": ORIGIN}
    )
    assert response.status_code == 202
    item = response.json()
    assert item["kind"] == "article"
    assert item["source_url"].startswith(url)
    assert item["state"] == "accepted"
    assert item["version"] is None
    assert item["paragraph_count"] == 0
    assert client.get("/api/items").json()["items"] == [item]


@pytest.mark.parametrize(
    "url",
    [
        "not a URL",
        "ftp://example.test/file",
        "file:///etc/passwd",
        "https://user:password@example.test/",
        "https:///missing-host",
        "http://localhost/article",
        "http://127.0.0.1/article",
        "http://[::1]/article",
        "http://10.0.0.1/article",
        "https://example.test:bad/",
        "https://example.test/\nHeader: injected",
    ],
)
def test_invalid_or_prohibited_article_urls_get_422_and_no_job(client, database, url):
    sign_in(client)
    response = client.post(
        "/api/items/article", json={"url": url}, headers={"Origin": ORIGIN}
    )
    assert response.status_code == 422
    assert database.list_items() == []


@pytest.mark.parametrize("filename", ["notes.md", "notes.markdown", "NOTES.MD"])
def test_supported_markdown_extensions_and_original_bytes(client, filename):
    sign_in(client)
    content = "# Heading\n\nUnicode: Привет и 世界.\n".encode()
    item = submit_markdown(client, content, filename)
    assert item["filename"] == filename
    assert item["title"] == Path(filename).stem
    response = client.get(f"/api/items/{item['id']}/source")
    assert response.status_code == 200
    assert response.content == content
    assert response.headers["content-type"].startswith("text/plain")
    assert response.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"/api/items/{item['id']}").json()["source_available"] is True


@pytest.mark.parametrize(
    ("filename", "content"),
    [
        ("notes.txt", b"text"),
        ("../notes.md", b"text"),
        ("..\\notes.md", b"text"),
        ("bad\x00name.md", b"text"),
        ("notes.md", b"\xff\xfe\x00"),
        ("notes.md", b""),
        ("notes.md", b" \r\n\t "),
        ("notes.md", b"valid\x00invalid"),
    ],
)
def test_invalid_markdown_inputs_get_422_and_create_no_job(
    client, database, filename, content
):
    sign_in(client)
    response = client.post(
        "/api/items/markdown",
        files={"file": (filename, content, "application/octet-stream")},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 422
    assert database.list_items() == []


def test_upload_at_limit_is_accepted_and_above_limit_is_422(settings, database, store):
    limited = replace(settings, upload_max_bytes=32)
    with TestClient(create_app(limited, database=database, store=store), base_url=ORIGIN) as client:
        sign_in(client)
        accepted = client.post(
            "/api/items/markdown",
            files={"file": ("limit.md", b"a" * 32, "text/markdown")},
            headers={"Origin": ORIGIN},
        )
        assert accepted.status_code == 202
        rejected = client.post(
            "/api/items/markdown",
            files={"file": ("limit.md", b"a" * 33, "text/markdown")},
            headers={"Origin": ORIGIN},
        )
        assert rejected.status_code == 422
        assert len(database.list_items()) == 1


def test_oversize_entire_request_is_bounded_before_parsing(client, settings):
    response = client.post(
        "/api/items/markdown",
        content=b"x" * (settings.request_max_bytes + 1),
        headers={"Origin": ORIGIN, "Content-Type": "application/octet-stream"},
    )
    assert response.status_code == 413
    assert response.json() == {"detail": "Request body is too large."}


def test_script_and_html_markdown_become_inert_plain_paragraphs(
    client, worker_factory
):
    sign_in(client)
    content = (
        b"# <img src=x onerror=alert(1)> Heading\n\n"
        b"<script>alert('script')</script>\n\n"
        b"[label](https://attacker.invalid/) and **bold**."
    )
    item = submit_markdown(client, content, "xss.md")
    assert worker_factory().run_once()
    detail = client.get(f"/api/items/{item['id']}").json()
    assert detail["item"]["state"] == "ready"
    joined = " ".join(paragraph["text"] for paragraph in detail["paragraphs"])
    assert "<script" not in joined
    assert "<img" not in joined
    assert "onerror=" not in joined
    assert "alert('script')" in joined
    assert "label and bold." in joined
    source = client.get(f"/api/items/{item['id']}/source")
    assert source.headers["content-type"].startswith("text/plain")


def test_markdown_links_images_and_html_never_fetch_recorded_endpoint(
    client, worker_factory
):
    requests = []

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            requests.append(self.path)
            self.send_response(200)
            self.end_headers()

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        target = f"http://127.0.0.1:{server.server_port}/must-not-load"
        sign_in(client)
        content = (
            f"[link]({target})\n\n![image]({target})\n\n"
            f'<img src="{target}"><iframe src="{target}"></iframe>text'
        ).encode()
        item = submit_markdown(client, content)
        worker_factory().run_once()
        time.sleep(0.05)
        assert requests == []
        assert client.get(f"/api/items/{item['id']}").status_code == 200
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_plain_parser_does_not_resolve_or_fetch_link_targets(monkeypatch):
    import http.client

    def forbidden(*args, **kwargs):
        raise AssertionError("a linked resource was requested")

    monkeypatch.setattr(http.client.HTTPConnection, "connect", forbidden)
    paragraphs = plain_paragraphs(
        "[text](https://example.invalid) ![alt](https://example.invalid/image)"
    )
    assert paragraphs == [{"id": "p0", "text": "text alt"}]


def test_article_has_no_original_markdown_source(client):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/article"},
        headers={"Origin": ORIGIN},
    )
    item_id = response.json()["id"]
    assert client.get(f"/api/items/{item_id}/source").status_code == 404
    assert client.get(f"/api/items/{item_id}").json()["source_available"] is False


def test_candidate_version_is_not_public_before_ready(client, database):
    sign_in(client)
    item = submit_markdown(client)
    job = database.get_item_job(item["id"])
    base = f"/api/items/{item['id']}/versions/{job['candidate_version']}"
    assert client.get(f"{base}/text").status_code == 404
    assert client.get(f"{base}/timings").status_code == 404
    assert client.get(f"{base}/audio").status_code == 404


def test_extra_json_fields_are_rejected(client, database):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test", "admin": True},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 422
    assert database.list_items() == []
