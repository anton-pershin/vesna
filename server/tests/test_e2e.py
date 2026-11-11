"""Complete fake-source/fake-speech jobs through the real public API and FFmpeg."""

from __future__ import annotations

from comourat.models import ArticleResult

from conftest import ORIGIN, FakeArticle, FakeTts, sign_in, submit_markdown
from vesna.audio import AudioAssembler
from vesna.worker import Worker


def test_article_end_to_end_uses_only_adapter_and_publishes_consistent_version(
    client, database, store, settings
):
    sign_in(client)
    response = client.post(
        "/api/items/article",
        json={"url": "https://example.test/start"},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 202
    item_id = response.json()["id"]
    adapter = FakeArticle(
        [
            ArticleResult(
                title="Complete fixture article",
                source_url="https://example.test/final",
                text="First complete paragraph.\n\nSecond complete paragraph.\n\nThird complete paragraph.",
            )
        ]
    )
    tts = FakeTts()
    Worker(
        settings, database, store, article_adapter=adapter, tts_client=tts
    ).run_once()
    detail = client.get(f"/api/items/{item_id}").json()
    assert detail["item"]["state"] == "ready"
    assert detail["item"]["title"] == "Complete fixture article"
    assert detail["item"]["paragraph_count"] == 3
    assert detail["item"]["version"]
    version = detail["item"]["version"]
    text = client.get(f"/api/items/{item_id}/versions/{version}/text").json()
    timings = client.get(f"/api/items/{item_id}/versions/{version}/timings").json()
    assert text["version"] == version
    assert text["paragraphs"] == detail["paragraphs"]
    assert len(timings["timings"]) == 3
    assert [call for call in tts.calls] == [p["text"] for p in text["paragraphs"]]
    audio = client.get(f"/api/items/{item_id}/versions/{version}/audio")
    assert audio.status_code == 200
    duration, codec = AudioAssembler(store).probe(store.path(f"versions/{version}/audio.mp3"))
    assert codec == "mp3"
    assert timings["timings"][-1]["end"] == duration
    assert adapter.calls == ["https://example.test/start"]


def test_markdown_end_to_end_preserves_unsummarized_paragraph_text(
    client, database, store, settings
):
    sign_in(client)
    original = "Heading text\n\nA [linked label](https://example.invalid) stays text.\n\nFinal **paragraph**."
    item = submit_markdown(client, original.encode(), "complete.markdown")
    Worker(settings, database, store, tts_client=FakeTts()).run_once()
    detail = client.get(f"/api/items/{item['id']}").json()
    assert [paragraph["text"] for paragraph in detail["paragraphs"]] == [
        "Heading text",
        "A linked label stays text.",
        "Final paragraph.",
    ]
    assert client.get(f"/api/items/{item['id']}/source").content == original.encode()
    version = detail["item"]["version"]
    assert client.get(f"/api/items/{item['id']}/versions/{version}/text").json()[
        "paragraphs"
    ] == detail["paragraphs"]
