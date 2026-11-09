"""Deterministic contract tests for the public comourat adapter."""

from comourat.clients.arxiv import ArxivMetadataError
from comourat.enrichment.page_fetch import ArticleFetchError
from comourat.enrichment.summarizer import (
    EmptySummary,
    SummaryFailure,
    SummarySuccess,
)
from comourat.models import (
    ArticleResult,
    EmptyEnrichment,
    EnrichmentFailure,
    EnrichmentSuccess,
    PaperRecord,
    RedditPostInfo,
)
import pytest

from vesna.comourat_integration import (
    ComouratAdapter,
    ComouratAdapterError,
    RedditPreparationResult,
)


def _return_or_raise(outcome):
    if isinstance(outcome, BaseException):
        raise outcome
    return outcome


class FakePageFetcher:
    def __init__(self, outcome):
        self.outcome = outcome
        self.urls = []

    def fetch(self, url):
        self.urls.append(url)
        return _return_or_raise(self.outcome)


class FakeRedditCollector:
    def __init__(self, outcome):
        self.outcome = outcome
        self.references = []

    def collect(self, reference):
        self.references.append(reference)
        return _return_or_raise(self.outcome)


class FakeEnrichmentAgent:
    def __init__(self, outcome):
        self.outcome = outcome
        self.prompts = []

    def enrich(self, prompt):
        self.prompts.append(prompt)
        return _return_or_raise(self.outcome)


class FakeSummarize:
    def __init__(self, outcome):
        self.outcome = outcome
        self.calls = []

    def __call__(self, model, content, *, retries, overall_timeout):
        self.calls.append((model, content, retries, overall_timeout))
        return _return_or_raise(self.outcome)


class FakeArxivClient:
    def __init__(self, outcome):
        self.outcome = outcome
        self.references = []

    def get_metadata(self, reference):
        self.references.append(reference)
        return _return_or_raise(self.outcome)


def make_post():
    return RedditPostInfo(
        subreddit="science",
        submission_id="abc123",
        title="A post title",
        author="author",
        date="2026-01-02T03:04:05+00:00",
        url="https://www.reddit.com/r/science/comments/abc123/a_post_title/",
        text="The complete post text.",
        score=42,
    )


def make_paper():
    return PaperRecord(title="Paper title", abstract="Paper abstract")


def make_adapter(**overrides):
    dependencies = {
        "page_fetcher": FakePageFetcher(
            ArticleResult(title="Title", source_url="https://example.test", text="Text")
        ),
        "reddit_collector": FakeRedditCollector(make_post()),
        "enrichment_agent": FakeEnrichmentAgent(EmptyEnrichment()),
        "arxiv_client": FakeArxivClient(make_paper()),
        "summarize_operation": FakeSummarize(SummarySuccess(summary="Summary")),
        "summary_model": object(),
        "summary_retries": 2,
        "summary_overall_timeout": 17.5,
    }
    dependencies.update(overrides)
    return ComouratAdapter(**dependencies)


def test_article_result_and_url_are_delegated_unchanged():
    article = ArticleResult(
        title="Article", source_url="https://example.test/final", text="Full text"
    )
    fetcher = FakePageFetcher(article)

    result = make_adapter(page_fetcher=fetcher).fetch_article(
        "https://example.test/start"
    )

    assert result is article
    assert fetcher.urls == ["https://example.test/start"]


def test_article_error_propagates_unchanged():
    error = ArticleFetchError("timeout")
    fetcher = FakePageFetcher(error)

    with pytest.raises(ArticleFetchError) as caught:
        make_adapter(page_fetcher=fetcher).fetch_article("https://example.test")

    assert caught.value is error


def test_reddit_context_is_preserved_and_prompt_and_summary_config_are_explicit():
    post = make_post()
    enrichment = EnrichmentSuccess(
        additional_context=["First web fact.", "Second web fact."]
    )
    agent = FakeEnrichmentAgent(enrichment)
    summarize = FakeSummarize(SummarySuccess(summary="  Compact summary.  "))
    model = object()
    adapter = make_adapter(
        reddit_collector=FakeRedditCollector(post),
        enrichment_agent=agent,
        summarize_operation=summarize,
        summary_model=model,
        summary_retries=4,
        summary_overall_timeout=23.0,
    )

    result = adapter.prepare_reddit(post.url)

    assert isinstance(result, RedditPreparationResult)
    assert result.post is post
    assert result.enrichment is enrichment
    assert result.summary == "Compact summary."
    assert agent.prompts == [post.model_dump_json()]
    expected_content = (
        f"Reddit post:\n{post.model_dump_json()}\n\n"
        "Additional context:\n- First web fact.\n- Second web fact."
    )
    assert summarize.calls == [(model, expected_content, 4, 23.0)]


def test_reddit_no_context_still_summarizes_post_and_preserves_empty_outcome():
    post = make_post()
    enrichment = EmptyEnrichment()
    summarize = FakeSummarize(SummarySuccess(summary="Post-only summary"))

    result = make_adapter(
        reddit_collector=FakeRedditCollector(post),
        enrichment_agent=FakeEnrichmentAgent(enrichment),
        summarize_operation=summarize,
    ).prepare_reddit("abc123")

    assert result.enrichment is enrichment
    assert result.summary == "Post-only summary"
    _, content, _, _ = summarize.calls[0]
    assert content == f"Reddit post:\n{post.model_dump_json()}"
    assert "Additional context" not in content


@pytest.mark.parametrize(
    ("upstream_category", "adapter_category"),
    [
        ("search", "enrichment_search"),
        ("fetch", "enrichment_fetch"),
        ("provider", "enrichment_provider"),
        ("usage_limit", "enrichment_usage_limit"),
        ("timeout", "enrichment_timeout"),
    ],
)
def test_reddit_enrichment_failures_are_distinct_and_sanitized(
    upstream_category, adapter_category
):
    summarize = FakeSummarize(SummarySuccess(summary="must not be returned"))
    failure = EnrichmentFailure(
        error_category=upstream_category,
        error_message="sensitive upstream detail",
    )

    with pytest.raises(ComouratAdapterError) as caught:
        make_adapter(
            enrichment_agent=FakeEnrichmentAgent(failure),
            summarize_operation=summarize,
        ).prepare_reddit("abc123")

    assert caught.value.category == adapter_category
    assert "sensitive upstream detail" not in str(caught.value)
    assert summarize.calls == []


@pytest.mark.parametrize(
    ("error", "category"),
    [
        (ValueError("sensitive invalid input"), "reddit_invalid"),
        (LookupError("sensitive unavailable detail"), "reddit_unavailable"),
        (TimeoutError("sensitive timeout detail"), "reddit_timeout"),
        (RuntimeError("sensitive provider detail"), "reddit_provider"),
    ],
)
def test_reddit_collector_failures_are_sanitized_before_enrichment(error, category):
    agent = FakeEnrichmentAgent(EmptyEnrichment())

    with pytest.raises(ComouratAdapterError) as caught:
        make_adapter(
            reddit_collector=FakeRedditCollector(error), enrichment_agent=agent
        ).prepare_reddit("abc123")

    assert caught.value.category == category
    assert "sensitive" not in str(caught.value)
    assert agent.prompts == []


@pytest.mark.parametrize(
    ("outcome", "category"),
    [
        (EmptySummary(), "empty_summary"),
        (SummarySuccess(summary=" \n\t "), "empty_summary"),
        (
            SummaryFailure(
                error_category="provider", error_message="sensitive provider detail"
            ),
            "summary_provider",
        ),
        (
            SummaryFailure(
                error_category="timeout", error_message="sensitive timeout detail"
            ),
            "summary_timeout",
        ),
    ],
)
def test_reddit_empty_and_failed_summaries_never_return_success(outcome, category):
    with pytest.raises(ComouratAdapterError) as caught:
        make_adapter(summarize_operation=FakeSummarize(outcome)).prepare_reddit(
            "abc123"
        )

    assert caught.value.category == category
    assert "sensitive" not in str(caught.value)


@pytest.mark.parametrize(
    "reference",
    [
        "2601.01234",
        "https://arxiv.org/abs/2601.01234",
        "https://arxiv.org/pdf/2601.01234.pdf",
    ],
)
def test_arxiv_id_and_url_forms_are_passed_to_client(reference):
    paper = make_paper()
    client = FakeArxivClient(paper)

    result = make_adapter(arxiv_client=client).get_arxiv_metadata(reference)

    assert result is paper
    assert client.references == [reference]


def test_arxiv_not_found_is_an_explicit_adapter_error():
    with pytest.raises(ComouratAdapterError) as caught:
        make_adapter(arxiv_client=FakeArxivClient(None)).get_arxiv_metadata(
            "2601.01234"
        )

    assert caught.value.category == "not_found"


@pytest.mark.parametrize(
    "paper",
    [
        PaperRecord(title=" \n", abstract="Abstract"),
        PaperRecord(title="Title", abstract="\t "),
    ],
)
def test_arxiv_empty_title_or_abstract_is_an_explicit_adapter_error(paper):
    with pytest.raises(ComouratAdapterError) as caught:
        make_adapter(arxiv_client=FakeArxivClient(paper)).get_arxiv_metadata(
            "2601.01234"
        )

    assert caught.value.category == "empty_metadata"


def test_arxiv_provider_error_propagates_unchanged():
    error = ArxivMetadataError("provider detail")

    with pytest.raises(ArxivMetadataError) as caught:
        make_adapter(arxiv_client=FakeArxivClient(error)).get_arxiv_metadata(
            "2601.01234"
        )

    assert caught.value is error
