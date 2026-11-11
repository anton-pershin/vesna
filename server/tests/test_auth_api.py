"""Authentication, cookie, Origin, Host, and ownership security tests."""

from __future__ import annotations

import hashlib
import sqlite3
from uuid import uuid4

import pytest

from conftest import ORIGIN, PASSWORD, sign_in, submit_markdown
from vesna.auth import hash_password, verify_password
from vesna.password_cli import main as password_cli


def test_sign_in_sets_opaque_secure_host_only_server_side_session(client, database):
    token = sign_in(client)
    assert len(token) >= 40
    assert token.count(".") < 2
    with database.connect() as connection:
        row = connection.execute("SELECT * FROM sessions").fetchone()
    assert row["token_hash"] == hashlib.sha256(token.encode("ascii")).hexdigest()
    assert row["token_hash"] != token
    assert client.get("/api/auth/session").json() == {"authenticated": True}


def test_cookie_has_required_attributes_and_no_domain(client):
    response = client.post(
        "/api/auth/sign-in", json={"password": PASSWORD}, headers={"Origin": ORIGIN}
    )
    cookie = response.headers["set-cookie"]
    assert "Secure" in cookie
    assert "HttpOnly" in cookie
    assert "SameSite=strict" in cookie
    assert "Path=/" in cookie
    assert "Domain=" not in cookie
    assert "Cache-Control" in response.headers and response.headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("password", ["wrong", "", PASSWORD + "x"])
def test_invalid_password_gets_401_and_no_cookie(client, password):
    response = client.post(
        "/api/auth/sign-in", json={"password": password}, headers={"Origin": ORIGIN}
    )
    assert response.status_code == 401
    assert "set-cookie" not in response.headers


def test_sign_out_invalidates_server_session_even_if_cookie_is_replayed(client):
    token = sign_in(client)
    response = client.post("/api/auth/sign-out", headers={"Origin": ORIGIN})
    assert response.status_code == 204
    client.cookies.set("vesna_session", token, domain="app.test", path="/")
    assert client.get("/api/auth/session").status_code == 401
    assert client.get("/api/items").status_code == 401


def test_forged_and_expired_sessions_are_rejected(client, database):
    client.cookies.set("vesna_session", "forged-token", domain="app.test", path="/")
    assert client.get("/api/items").status_code == 401
    token = "x" * 43
    database.create_session(hashlib.sha256(token.encode()).hexdigest(), 1)
    with database.transaction() as connection:
        connection.execute("UPDATE sessions SET expires_at = 0")
    client.cookies.set("vesna_session", token, domain="app.test", path="/")
    assert client.get("/api/items").status_code == 401


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/items"),
        ("GET", "/api/items/unknown"),
        ("GET", "/api/items/unknown/source"),
        ("GET", "/api/items/unknown/versions/unknown/text"),
        ("GET", "/api/items/unknown/versions/unknown/timings"),
        ("GET", "/api/items/unknown/versions/unknown/audio"),
        ("POST", "/api/items/unknown/retry"),
        ("POST", "/api/items/article"),
    ],
)
def test_private_routes_require_authentication(client, method, path):
    kwargs = {"headers": {"Origin": ORIGIN}}
    if path.endswith("article"):
        kwargs["json"] = {"url": "https://example.test"}
    response = client.request(method, path, **kwargs)
    assert response.status_code == 401


def test_unauthenticated_upload_cannot_create_item(client, database):
    response = client.post(
        "/api/items/markdown",
        files={"file": ("private.md", b"private", "text/markdown")},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 401
    assert database.list_items() == []


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"Origin": "https://attacker.test"},
        {"Origin": "null"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "cross-site"},
        {"Origin": ORIGIN, "Sec-Fetch-Site": "same-site"},
        {"Origin": f"{ORIGIN}, https://attacker.test"},
    ],
)
def test_mutations_require_strict_public_origin(client, database, headers):
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/article"},
        headers=headers,
    )
    assert response.status_code == 403
    assert database.list_items() == []


def test_sign_in_origin_is_checked_before_credentials(client, database):
    response = client.post(
        "/api/auth/sign-in",
        json={"password": PASSWORD},
        headers={"Origin": "https://attacker.test"},
    )
    assert response.status_code == 403
    with database.connect() as connection:
        assert connection.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0


def test_untrusted_host_and_forwarded_headers_do_not_change_urls_or_cookie(client):
    response = client.post(
        "/api/auth/sign-in",
        json={"password": PASSWORD},
        headers={
            "Origin": ORIGIN,
            "Host": "attacker.invalid",
            "X-Forwarded-Host": "forwarded.invalid",
            "X-Forwarded-Proto": "http",
            "Forwarded": "host=also-invalid;proto=http",
        },
    )
    assert response.status_code == 204
    assert "location" not in response.headers
    cookie = response.headers["set-cookie"]
    assert "Domain=" not in cookie
    assert "attacker" not in cookie and "forwarded" not in cookie
    no_redirect = client.get("/api/items/", headers={"Host": "attacker.invalid"})
    assert no_redirect.status_code == 404
    assert "location" not in no_redirect.headers


def test_password_hash_verification_and_malformed_hashes():
    encoded = hash_password("a test secret", salt=b"0123456789abcdef")
    assert verify_password("a test secret", encoded)
    assert not verify_password("wrong", encoded)
    for malformed in ["", "plaintext", "scrypt$1$2$3$4", "scrypt$2$8$1$bad$bad"]:
        assert not verify_password("a test secret", malformed)


def test_password_cli_uses_hidden_confirmation_and_ne_prints_password(monkeypatch, capsys):
    prompts = iter(["a test secret", "a test secret"])
    monkeypatch.setattr("getpass.getpass", lambda prompt: next(prompts))
    password_cli()
    output = capsys.readouterr().out
    assert "a test secret" not in output
    assert output.startswith("scrypt$")


def test_validation_errors_do_not_reflect_password_or_input(client):
    response = client.post(
        "/api/auth/sign-in",
        content='{"password":{"sensitive":"do-not-reflect"}}',
        headers={"Origin": ORIGIN, "Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json() == {"detail": "Invalid request."}
    assert "do-not-reflect" not in response.text


def test_other_owner_item_and_versions_are_not_accessible(client, database):
    sign_in(client)
    other_id = str(uuid4())
    with database.transaction() as connection:
        connection.execute(
            "INSERT INTO items(id, owner, kind, state, created_at, updated_at) "
            "VALUES (?, 'someone-else', 'markdown', 'failed', 1, 1)",
            (other_id,),
        )
    assert client.get(f"/api/items/{other_id}").status_code == 404
    assert client.get(f"/api/items/{other_id}/source").status_code == 404
    assert client.post(
        f"/api/items/{other_id}/retry", headers={"Origin": ORIGIN}
    ).status_code == 404
    assert client.get(f"/api/items/{other_id}/versions/{uuid4()}/audio").status_code == 404
