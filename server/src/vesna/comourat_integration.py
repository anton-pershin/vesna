"""Small, dependency-injected integration boundary for public comourat APIs."""

from __future__ import annotations

from typing import Annotated, Any, Literal, Protocol, TypeAlias

from pydantic import BaseModel, Field

from comourat.clients.arxiv import ArxivClient
from comourat.collectors.reddit import RedditSubmissionCollector
from comourat.enrichment.enricher import EnrichmentAgent
from comourat.enrichment.page_fetch import PageFetcher
from comourat.enrichment.summarizer import (
    EmptySummary,
    SummaryFailure,
    SummaryResult,
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

AdapterErrorCategory: TypeAlias = Literal[
    "reddit_invalid",
    "reddit_unavailable",
    "reddit_provider",
    "reddit_timeout",
    "enrichment_search",
    "enrichment_fetch",
    "enrichment_provider",
    "enrichment_usage_limit",
    "enrichment_timeout",
    "summary_provider",
    "summary_timeout",
    "empty_summary",
    "not_found",
    "empty_metadata",
]

_ERROR_MESSAGES: dict[AdapterErrorCategory, str] = {
    "reddit_invalid": "Reddit post reference is invalid.",
    "reddit_unavailable": "Reddit post is unavailable.",
    "reddit_provider": "Reddit collection provider failed.",
    "reddit_timeout": "Reddit collection exceeded the overall deadline.",
    "enrichment_search": "Reddit enrichment web search failed.",
    "enrichment_fetch": "Reddit enrichment URL extraction failed.",
    "enrichment_provider": "Reddit enrichment provider failed.",
    "enrichment_usage_limit": "Reddit enrichment usage limit exceeded.",
    "enrichment_timeout": "Reddit enrichment exceeded the overall deadline.",
    "summary_provider": "Reddit summarization provider failed.",
    "summary_timeout": "Reddit summarization exceeded the overall deadline.",
    "empty_summary": "Reddit summarization returned an empty summary.",
    "not_found": "arXiv paper metadata was not found.",
    "empty_metadata": "arXiv metadata must contain a non-empty title and abstract.",
}

_ENRICHMENT_ERROR_CATEGORIES: dict[str, AdapterErrorCategory] = {
    "search": "enrichment_search",
    "fetch": "enrichment_fetch",
    "provider": "enrichment_provider",
    "usage_limit": "enrichment_usage_limit",
    "timeout": "enrichment_timeout",
}

_SUMMARY_ERROR_CATEGORIES: dict[str, AdapterErrorCategory] = {
    "provider": "summary_provider",
    "timeout": "summary_timeout",
}


class SummarizeOperation(Protocol):
    """Callable contract of ``comourat.enrichment.summarizer.summarize``."""

    def __call__(
        self,
        model: Any,
        content: str,
        *,
        retries: int,
        overall_timeout: float,
    ) -> SummaryResult: ...


class ComouratAdapterError(RuntimeError):
    """A sanitized adapter failure with a stable ``category`` attribute."""

    def __init__(self, category: AdapterErrorCategory) -> None:
        self.category = category
        super().__init__(_ERROR_MESSAGES[category])


class RedditPreparationResult(BaseModel):
    """A collected Reddit post, its successful enrichment, and a non-empty summary.

    Enrichment failures are raised as :class:`ComouratAdapterError` and therefore
    cannot be represented as a successful preparation.
    """

    post: RedditPostInfo
    enrichment: Annotated[
        EnrichmentSuccess | EmptyEnrichment,
        Field(discriminator="outcome"),
    ]
    summary: str = Field(min_length=1)


class ComouratAdapter:
    """Delegate source operations to injected comourat collaborators.

    The constructor performs no configuration or environment lookup and creates
    no clients. Article-only composition supplies only ``page_fetcher``; legacy
    Reddit and arXiv operations require their respective explicit collaborators.
    Expected article and arXiv provider exceptions are deliberately not wrapped.
    """

    def __init__(
        self,
        *,
        page_fetcher: PageFetcher,
        reddit_collector: RedditSubmissionCollector | None = None,
        enrichment_agent: EnrichmentAgent | None = None,
        arxiv_client: ArxivClient | None = None,
        summarize_operation: SummarizeOperation | None = None,
        summary_model: Any = None,
        summary_retries: int = 0,
        summary_overall_timeout: float = 60.0,
    ) -> None:
        self._page_fetcher = page_fetcher
        self._reddit_collector = reddit_collector
        self._enrichment_agent = enrichment_agent
        self._arxiv_client = arxiv_client
        self._summarize_operation = summarize_operation
        self._summary_model = summary_model
        self._summary_retries = summary_retries
        self._summary_overall_timeout = summary_overall_timeout

    def fetch_article(self, url: str) -> ArticleResult:
        """Return ``PageFetcher.fetch(url)`` unchanged, including its errors."""
        return self._page_fetcher.fetch(url)

    def prepare_reddit(self, reference: str) -> RedditPreparationResult:
        """Collect, enrich, and summarize one Reddit submission.

        The enrichment prompt is ``post.model_dump_json()``. The summarization
        prompt has the deterministic form ``"Reddit post:\\n<post JSON>"``. If
        enrichment supplies context, ``"\\n\\nAdditional context:\\n- <point>"``
        and one line per further point are appended. No-context enrichment omits
        that section. The original post and enrichment are retained in the
        result; comments are never collected.

        Collector failures become sanitized categories. Enrichment failures, summary provider or
        timeout failures, and empty (including whitespace-only) summaries raise
        categorized, sanitized :class:`ComouratAdapterError` instances.
        """
        if (
            self._reddit_collector is None
            or self._enrichment_agent is None
            or self._summarize_operation is None
        ):
            raise RuntimeError("Reddit preparation is not configured in article-only mode.")
        try:
            post = self._reddit_collector.collect(reference)
        except ValueError as error:
            raise ComouratAdapterError("reddit_invalid") from error
        except LookupError as error:
            raise ComouratAdapterError("reddit_unavailable") from error
        except TimeoutError as error:
            raise ComouratAdapterError("reddit_timeout") from error
        except RuntimeError as error:
            raise ComouratAdapterError("reddit_provider") from error
        enrichment = self._enrichment_agent.enrich(post.model_dump_json())
        if isinstance(enrichment, EnrichmentFailure):
            raise ComouratAdapterError(
                _ENRICHMENT_ERROR_CATEGORIES[enrichment.error_category]
            )

        content = f"Reddit post:\n{post.model_dump_json()}"
        if enrichment.additional_context:
            points = "\n".join(f"- {point}" for point in enrichment.additional_context)
            content = f"{content}\n\nAdditional context:\n{points}"

        summary_result = self._summarize_operation(
            self._summary_model,
            content,
            retries=self._summary_retries,
            overall_timeout=self._summary_overall_timeout,
        )
        if isinstance(summary_result, SummaryFailure):
            raise ComouratAdapterError(
                _SUMMARY_ERROR_CATEGORIES[summary_result.error_category]
            )
        if isinstance(summary_result, EmptySummary):
            raise ComouratAdapterError("empty_summary")

        summary = summary_result.summary.strip()
        if not summary:
            raise ComouratAdapterError("empty_summary")
        return RedditPreparationResult(
            post=post,
            enrichment=enrichment,
            summary=summary,
        )

    def get_arxiv_metadata(self, reference: str) -> PaperRecord:
        """Return non-empty metadata for an arXiv ID, abstract URL, or PDF URL.

        The reference is passed directly to ``ArxivClient.get_metadata``. A
        ``None`` result raises category ``not_found``; a blank title or abstract
        raises category ``empty_metadata``. ``ArxivMetadataError`` and other
        client exceptions propagate unchanged.
        """
        if self._arxiv_client is None:
            raise RuntimeError("arXiv metadata is not configured in article-only mode.")
        record = self._arxiv_client.get_metadata(reference)
        if record is None:
            raise ComouratAdapterError("not_found")
        if not record.title.strip() or not record.abstract.strip():
            raise ComouratAdapterError("empty_metadata")
        return record


__all__ = [
    "AdapterErrorCategory",
    "ComouratAdapter",
    "ComouratAdapterError",
    "RedditPreparationResult",
    "SummarizeOperation",
]
