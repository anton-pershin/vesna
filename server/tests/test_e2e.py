"""Complete fake-source/fake-speech jobs through the real public API and FFmpeg."""

from __future__ import annotations

from dataclasses import replace

from comourat.enrichment.page_fetch import extract_main_content
from comourat.models import ArticleResult

from conftest import ORIGIN, FakeArticle, FakeTts, sign_in, submit_markdown
from vesna.audio import AudioAssembler
from vesna.worker import Worker


def test_real_extractor_article_end_to_end_preserves_source_boundaries(
    client, database, store, settings
):
    extracted_text = extract_main_content(
        """<!doctype html>
        <html><head><title>Controlled article</title></head><body><article>
        <h1>Controlled article heading</h1>
        <p>The first source paragraph contains enough controlled text to remain visible during extraction.</p>
        <p>The second source paragraph contains different controlled text and must remain a separate paragraph.</p>
        <p>The third source paragraph completes the article and supplies the final boundary for preparation.</p>
        </article></body></html>"""
    )
    expected_texts = [
        "Controlled article heading",
        "The first source paragraph contains enough controlled text to remain visible during extraction.",
        "The second source paragraph contains different controlled text and must remain a separate paragraph.",
        "The third source paragraph completes the article and supplies the final boundary for preparation.",
    ]
    assert extracted_text == "\n".join(expected_texts)

    sign_in(client)
    source_url = "https://github.com/example/controlled-repository"
    response = client.post(
        "/api/items/article",
        json={"url": source_url},
        headers={"Origin": ORIGIN},
    )
    assert response.status_code == 202
    item_id = response.json()["id"]
    adapter = FakeArticle(
        [
            ArticleResult(
                title="Complete fixture article",
                source_url=source_url,
                text=extracted_text,
            )
        ]
    )
    tts = FakeTts()
    preparation_settings = replace(
        settings, max_paragraph_chars=max(len(text) for text in expected_texts)
    )
    Worker(
        preparation_settings, database, store, article_adapter=adapter, tts_client=tts
    ).run_once()
    detail = client.get(f"/api/items/{item_id}").json()
    expected_paragraphs = [
        {"id": f"p{index}", "text": paragraph_text}
        for index, paragraph_text in enumerate(expected_texts)
    ]
    assert detail["item"]["state"] == "ready"
    assert detail["item"]["title"] == "Complete fixture article"
    assert detail["item"]["paragraph_count"] == len(expected_paragraphs)
    assert detail["item"]["version"]
    assert detail["paragraphs"] == expected_paragraphs
    version = detail["item"]["version"]
    text = client.get(f"/api/items/{item_id}/versions/{version}/text").json()
    timings = client.get(f"/api/items/{item_id}/versions/{version}/timings").json()
    assert text["version"] == version
    assert text["paragraphs"] == expected_paragraphs
    assert [position["id"] for position in timings["timings"]] == [
        paragraph["id"] for paragraph in expected_paragraphs
    ]
    assert tts.calls == expected_texts
    audio = client.get(f"/api/items/{item_id}/versions/{version}/audio")
    assert audio.status_code == 200
    duration, codec = AudioAssembler(store).probe(store.path(f"versions/{version}/audio.mp3"))
    assert codec == "mp3"
    assert timings["timings"][-1]["end"] == duration
    assert adapter.calls == [source_url]


def test_markdown_end_to_end_preserves_unsummarized_paragraph_text(
    client, database, store, settings
):
    sign_in(client)
    original = "Heading text\nA [linked label](https://example.invalid) stays text.\nFinal **paragraph**."
    item = submit_markdown(client, original.encode(), "complete.markdown")
    tts = FakeTts()
    Worker(settings, database, store, tts_client=tts).run_once()
    detail = client.get(f"/api/items/{item['id']}").json()
    expected_texts = [
        "Heading text",
        "A linked label stays text.",
        "Final paragraph.",
    ]
    expected_paragraphs = [
        {"id": f"p{index}", "text": paragraph_text}
        for index, paragraph_text in enumerate(expected_texts)
    ]
    assert detail["item"]["state"] == "ready"
    assert detail["paragraphs"] == expected_paragraphs
    assert tts.calls == expected_texts
    assert client.get(f"/api/items/{item['id']}/source").content == original.encode()
    version = detail["item"]["version"]
    assert client.get(f"/api/items/{item['id']}/versions/{version}/text").json()[
        "paragraphs"
    ] == expected_paragraphs
    timings = client.get(f"/api/items/{item['id']}/versions/{version}/timings").json()
    assert [position["id"] for position in timings["timings"]] == [
        paragraph["id"] for paragraph in expected_paragraphs
    ]
