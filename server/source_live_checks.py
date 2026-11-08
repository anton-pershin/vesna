#!/usr/bin/env python3
"""Run explicit live article, Reddit, and arXiv integration checks."""

import argparse
import json
import os
from pathlib import Path

from comourat.clients.arxiv import ArxivClient
from comourat.clients.reddit import RedditSubmissionClient
from comourat.collectors.reddit import RedditSubmissionCollector
from comourat.enrichment.enricher import EnrichmentAgent
from comourat.enrichment.page_fetch import PageFetcher
from comourat.enrichment.summarizer import summarize
from pydantic_ai.models.openai import OpenAIResponsesModel
from pydantic_ai.providers.openai import OpenAIProvider

from vesna.comourat_integration import ComouratAdapter, ComouratAdapterError
from vesna.live_config import make_live_fetch_policy, sanitized_source_url

USER_AGENT = "VesnaM2/1.0 (+https://github.com/anton-pershin/vesna)"


def make_adapter(model_name: str, api_key: str, base_url: str | None, tts_host: str) -> ComouratAdapter:
    provider = OpenAIProvider(api_key=api_key, base_url=base_url)
    model = OpenAIResponsesModel(model_name, provider=provider)
    policy = make_live_fetch_policy(tts_host)
    return ComouratAdapter(
        page_fetcher=PageFetcher(fetch_policy=policy),
        reddit_collector=RedditSubmissionCollector(
            RedditSubmissionClient(
                USER_AGENT,
                connection_timeout=10,
                operation_timeout=60,
            )
        ),
        enrichment_agent=EnrichmentAgent(
            model,
            fetch_policy=policy,
            overall_timeout=120,
        ),
        arxiv_client=ArxivClient(
            USER_AGENT,
            timeout_seconds=10,
            overall_timeout_seconds=60,
            max_retries=1,
            regular_delay_seconds=0,
        ),
        summarize_operation=summarize,
        summary_model=model,
        summary_retries=0,
        summary_overall_timeout=60,
    )


def error_result(error: BaseException) -> dict:
    if isinstance(error, ComouratAdapterError):
        return {"status": "fail", "error_category": error.category}
    return {"status": "fail", "error_type": type(error).__name__}


def contains_expected(text: str, expected: str) -> bool:
    return bool(expected) and expected.casefold() in text.casefold()


def run_checks(
    adapter: ComouratAdapter,
    article_url: str,
    reddit_url: str,
    arxiv_reference: str,
    expected: dict,
) -> list[dict]:
    results = []
    try:
        article = adapter.fetch_article(article_url)
        if not contains_expected(article.title, expected["article_title"]) or not contains_expected(
            article.text, expected["article_text"]
        ):
            results.append({"check": "article", "status": "fail", "error_category": "unexpected_content"})
        else:
            results.append({
                "check": "article",
                "status": "pass",
                "title": article.title,
                "source_url": sanitized_source_url(article.source_url),
                "text_length": len(article.text),
            })
    except Exception as error:
        results.append({"check": "article", **error_result(error)})

    try:
        reddit = adapter.prepare_reddit(reddit_url)
        if not contains_expected(reddit.post.title, expected["reddit_title"]):
            results.append({"check": "reddit", "status": "fail", "error_category": "unexpected_content"})
        else:
            results.append({
                "check": "reddit",
                "status": "pass",
                "title": reddit.post.title,
                "source_url": sanitized_source_url(reddit.post.url),
                "enrichment_outcome": reddit.enrichment.outcome,
                "summary_length": len(reddit.summary),
            })
    except Exception as error:
        results.append({"check": "reddit", **error_result(error)})

    try:
        paper = adapter.get_arxiv_metadata(arxiv_reference)
        if not contains_expected(paper.title, expected["arxiv_title"]) or not contains_expected(
            paper.abstract, expected["arxiv_abstract"]
        ):
            results.append({"check": "arxiv", "status": "fail", "error_category": "unexpected_content"})
        else:
            results.append({
                "check": "arxiv",
                "status": "pass",
                "title": paper.title,
                "abstract_length": len(paper.abstract),
            })
    except Exception as error:
        results.append({"check": "arxiv", **error_result(error)})
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--article-url", required=True)
    parser.add_argument("--reddit-url", required=True)
    parser.add_argument("--arxiv-reference", required=True)
    parser.add_argument("--article-title-contains", required=True)
    parser.add_argument("--article-text-contains", required=True)
    parser.add_argument("--reddit-title-contains", required=True)
    parser.add_argument("--arxiv-title-contains", required=True)
    parser.add_argument("--arxiv-abstract-contains", required=True)
    parser.add_argument("--tts-host", default="vesna-test-tts.invalid")
    parser.add_argument("--openai-model", required=True)
    parser.add_argument("--openai-base-url")
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()

    api_key = os.environ.get(args.api_key_env)
    if not api_key:
        parser.error(f"API key is required in environment variable {args.api_key_env}")
    adapter = make_adapter(args.openai_model, api_key, args.openai_base_url, args.tts_host)
    expected = {
        "article_title": args.article_title_contains,
        "article_text": args.article_text_contains,
        "reddit_title": args.reddit_title_contains,
        "arxiv_title": args.arxiv_title_contains,
        "arxiv_abstract": args.arxiv_abstract_contains,
    }
    results = run_checks(
        adapter,
        args.article_url,
        args.reddit_url,
        args.arxiv_reference,
        expected,
    )
    payload = json.dumps(results, indent=2)
    print(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    return 0 if all(result["status"] == "pass" for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
