"""Authenticated MP3 delivery and RFC single-range behavior."""

from __future__ import annotations

import pytest

from conftest import sign_in, submit_markdown
from vesna.api import parse_range


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        (None, (None, 99, 200)),
        ("bytes=0-9", (0, 9, 206)),
        ("bytes=10-", (10, 99, 206)),
        ("bytes=-10", (90, 99, 206)),
        ("bytes=-1000", (0, 99, 206)),
        ("bytes=90-1000", (90, 99, 206)),
        ("bytes=100-", (None, 99, 416)),
        ("bytes=-0", (None, 99, 416)),
        ("bytes=9-2", (None, 99, 200)),
        ("bytes=0-1,4-5", (None, 99, 200)),
        ("nonsense", (None, 99, 200)),
        ("bytes=", (None, 99, 200)),
    ],
)
def test_range_parser_semantics(header, expected):
    assert parse_range(header, 100) == expected


def test_mp3_full_partial_suffix_unsatisfiable_and_head_responses(
    client, database, store, worker_factory
):
    sign_in(client)
    item = submit_markdown(client)
    worker_factory().run_once()
    ready = database.get_item(item["id"])
    version = ready["published_version"]
    path = f"/api/items/{item['id']}/versions/{version}/audio"
    audio = store.read_bytes(f"versions/{version}/audio.mp3")

    full = client.get(path)
    assert full.status_code == 200
    assert full.content == audio
    assert full.headers["accept-ranges"] == "bytes"
    assert full.headers["content-length"] == str(len(audio))
    assert full.headers["content-type"].startswith("audio/mpeg")
    assert "content-range" not in full.headers

    partial = client.get(path, headers={"Range": "bytes=0-9"})
    assert partial.status_code == 206
    assert partial.content == audio[:10]
    assert partial.headers["content-range"] == f"bytes 0-9/{len(audio)}"
    assert partial.headers["content-length"] == "10"

    open_ended = client.get(path, headers={"Range": "bytes=10-"})
    assert open_ended.status_code == 206
    assert open_ended.content == audio[10:]

    suffix = client.get(path, headers={"Range": "bytes=-7"})
    assert suffix.status_code == 206
    assert suffix.content == audio[-7:]
    assert suffix.headers["content-range"] == f"bytes {len(audio)-7}-{len(audio)-1}/{len(audio)}"

    clamped = client.get(path, headers={"Range": f"bytes=1-{len(audio)+100}"})
    assert clamped.status_code == 206
    assert clamped.content == audio[1:]

    unsatisfiable = client.get(path, headers={"Range": f"bytes={len(audio)}-"})
    assert unsatisfiable.status_code == 416
    assert unsatisfiable.content == b""
    assert unsatisfiable.headers["content-range"] == f"bytes */{len(audio)}"
    assert unsatisfiable.headers["content-length"] == "0"

    malformed = client.get(path, headers={"Range": "bytes=0-1,4-5"})
    assert malformed.status_code == 200
    assert malformed.content == audio

    head = client.head(path, headers={"Range": "bytes=2-5"})
    assert head.status_code == 206
    assert head.content == b""
    assert head.headers["content-length"] == "4"
    assert head.headers["content-range"] == f"bytes 2-5/{len(audio)}"


def test_audio_requires_auth_and_item_version_ownership(client, database, store, worker_factory):
    sign_in(client)
    first = submit_markdown(client)
    second = submit_markdown(client, b"Other content.")
    worker_factory().run_once()
    worker_factory().run_once()
    first_version = database.get_item(first["id"])["published_version"]
    path = f"/api/items/{second['id']}/versions/{first_version}/audio"
    assert client.get(path).status_code == 404
    client.post("/api/auth/sign-out", headers={"Origin": "https://app.test"})
    assert client.get(
        f"/api/items/{first['id']}/versions/{first_version}/audio"
    ).status_code == 401
