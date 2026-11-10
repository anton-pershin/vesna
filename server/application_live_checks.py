"""Run explicit M3 live source checks against a deployed application.

The provider password is read from a named environment variable and is never
written to the output. The target is a real public application HTTPS origin.
"""

import argparse
import hashlib
import json
import os
import time
from pathlib import Path

import httpx


def digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def sign_in(client: httpx.Client, origin: str, password: str) -> None:
    response = client.post(
        "/api/auth/sign-in",
        json={"password": password},
        headers={"Origin": origin},
    )
    require(response, 204)
    cookie = response.headers.get("set-cookie", "").lower()
    assert "secure" in cookie and "httponly" in cookie and "samesite=strict" in cookie


def require(response: httpx.Response, status: int) -> None:
    if response.status_code != status:
        raise RuntimeError(f"Unexpected HTTP status {response.status_code}; expected {status}")


def submit_sources(
    client: httpx.Client,
    origin: str,
    password: str,
    article_url: str,
    markdown_path: Path,
) -> tuple[str, str]:
    sign_in(client, origin, password)
    article = client.post(
        "/api/items/article",
        json={"url": article_url},
        headers={"Origin": origin},
    )
    require(article, 202)
    markdown = client.post(
        "/api/items/markdown",
        files={"file": (markdown_path.name, markdown_path.read_bytes(), "text/markdown")},
        headers={"Origin": origin},
    )
    require(markdown, 202)
    return article.json()["id"], markdown.json()["id"]


def wait_ready(client: httpx.Client, item_id: str, deadline: float) -> dict:
    while True:
        response = client.get(f"/api/items/{item_id}")
        require(response, 200)
        detail = response.json()
        state = detail["item"]["state"]
        if state == "ready":
            return detail
        if state == "failed":
            raise RuntimeError(f"Preparation failed with safe category: {detail['item']['error']}")
        if time.monotonic() > deadline:
            raise TimeoutError(f"Preparation did not finish; last state was {state}")
        time.sleep(0.5)


def artifact_data(client: httpx.Client, item: dict) -> tuple[dict, dict, bytes, dict]:
    item_id = item["id"]
    version = item["version"]
    base = f"/api/items/{item_id}/versions/{version}"
    text_response = client.get(f"{base}/text")
    timing_response = client.get(f"{base}/timings")
    require(text_response, 200)
    require(timing_response, 200)
    text = text_response.json()
    timings = timing_response.json()
    assert text["version"] == timings["version"] == version
    assert len(text["paragraphs"]) == len(timings["timings"]) > 0
    assert [p["id"] for p in text["paragraphs"]] == [p["id"] for p in timings["timings"]]
    audio_response = client.get(f"{base}/audio")
    require(audio_response, 200)
    audio = audio_response.content
    assert len(audio) > 1000
    partial = client.get(f"{base}/audio", headers={"Range": "bytes=100-199"})
    require(partial, 206)
    assert partial.content == audio[100:200]
    assert partial.headers["Content-Range"] == f"bytes 100-199/{len(audio)}"
    invalid = client.get(f"{base}/audio", headers={"Range": f"bytes={len(audio)}-"})
    require(invalid, 416)
    with httpx.Client(base_url=str(client.base_url), timeout=30) as unauthenticated:
        require(unauthenticated.get(f"{base}/audio"), 401)
    return text, timings, audio, {
        "audio_bytes": len(audio),
        "audio_sha256": digest(audio),
        "range_206": True,
        "range_416": True,
        "unauthenticated_artifact_status": 401,
    }


def run(args: argparse.Namespace) -> dict:
    password = os.environ.get(args.password_env)
    if not password:
        raise ValueError(f"Password is required in environment variable {args.password_env}")
    origin = args.public_origin.rstrip("/")
    markdown_path = Path(args.markdown_file)
    markdown_bytes = markdown_path.read_bytes()
    with httpx.Client(base_url=origin, timeout=30, follow_redirects=False) as client:
        require(client.get("/"), 200)
        require(client.get("/api/items"), 401)
        require(client.post(
            "/api/auth/sign-in",
            json={"password": "incorrect"},
            headers={"Origin": origin},
        ), 401)
        require(client.post(
            "/api/items/article",
            json={"url": args.article_url},
            headers={"Origin": "https://attacker.invalid"},
        ), 403)
        article_id, markdown_id = submit_sources(
            client, origin, password, args.article_url, markdown_path
        )

    # The submitting client is closed. Reconnect through a fresh client instead
    # of relying on its connection or cookies for preparation to continue.
    with httpx.Client(base_url=origin, timeout=30, follow_redirects=False) as client:
        require(client.get("/api/items"), 401)
        sign_in(client, origin, password)
        deadline = time.monotonic() + args.overall_timeout
        article_detail = wait_ready(client, article_id, deadline)
        markdown_detail = wait_ready(client, markdown_id, deadline)
        article = article_detail["item"]
        markdown = markdown_detail["item"]
        assert args.article_title_contains in article["title"]
        assert article["source_url"] == args.article_url
        article_text, _, article_audio, article_checks = artifact_data(client, article)
        markdown_text, _, markdown_audio, markdown_checks = artifact_data(client, markdown)
        combined = "\n".join(p["text"] for p in article_text["paragraphs"])
        assert args.article_text_contains in combined
        original = client.get(f"/api/items/{markdown_id}/source")
        require(original, 200)
        assert original.content == markdown_bytes
        require(client.post("/api/auth/sign-out", headers={"Origin": origin}), 204)
        require(client.get("/api/auth/session"), 401)

    return {
        "public_origin": origin,
        "tts_voice_id": args.voice_id,
        "results": [
            {
                "check": "article_live",
                "status": "pass",
                "title": article["title"],
                "source_url": article["source_url"],
                "paragraphs": len(article_text["paragraphs"]),
                "text_characters": len(combined),
                **article_checks,
                "expected_text_present": True,
                "credentials_recorded": False,
            },
            {
                "check": "markdown_live",
                "status": "pass",
                "title": markdown["title"],
                "filename": markdown["filename"],
                "paragraphs": len(markdown_text["paragraphs"]),
                "source_sha256": digest(markdown_bytes),
                **markdown_checks,
                "timing_version_matches_text": True,
                "preparation_continued_after_disconnect": True,
                "sign_out_invalidated_session": True,
                "credentials_recorded": False,
            },
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--public-origin", required=True)
    parser.add_argument("--password-env", default="VESNA_PASSWORD")
    parser.add_argument("--article-url", default="https://example.com/")
    parser.add_argument("--article-title-contains", default="Example Domain")
    parser.add_argument("--article-text-contains", default="documentation examples")
    parser.add_argument("--markdown-file", required=True)
    parser.add_argument("--voice-id", default="piper-en-us-joe-medium-cf910fb5")
    parser.add_argument("--overall-timeout", type=float, default=300)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    result = run(args)
    output = Path(args.output)
    output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
