# Comourat integration result

Status: **blocked — required comourat capabilities are missing**

## Test identity

- Vesna spec commit: `d8a4ac2`
- Comourat commit: `3c2b092e7766ce4f4c6ad771399aaf91bf44bd39`
- Comourat distribution metadata version: `0.0.0`
- Python: `3.12.3`
- Check date: `2026-11-03`
- Upstream baseline: 79 passed, 0 failed; see `upstream-tests.txt`

## Acceptance record

| Criterion | Result | Blocker and raw observation |
|---|---|---|
| AC1 Article extraction | blocked | `PageFetcher.fetch` returns text or `None`, without a title or distinguishable errors. [#6](https://github.com/anton-pershin/comourat/issues/6) requests the complete result/error contract and bounded operation time. |
| AC2 Reddit preparation | blocked | The collector reads subreddit feeds, not a specified post URL/ID. Enrichment tool failures can look like successful no-context results. The configured summarizer factory is private. See [#3](https://github.com/anton-pershin/comourat/issues/3), [#7](https://github.com/anton-pershin/comourat/issues/7), and [#4](https://github.com/anton-pershin/comourat/issues/4). |
| AC3 arXiv preparation | blocked | `ArxivClient.get_title_by_id` returns only a title. No unified ID/abstract/PDF URL operation returns title and abstract. See [#5](https://github.com/anton-pershin/comourat/issues/5). |
| AC4 Adapter and error contracts | blocked | A small Vesna adapter is possible, but truthful real-provider result and error contracts cannot be completed over the missing public interfaces. No private comourat APIs or substitute implementations were used. |
| AC5 URL-access security | blocked | No shared target, redirect, address-resolution, or prohibited-address policy exists for collection and enrichment fetches. [#2](https://github.com/anton-pershin/comourat/issues/2) requests the required controls and zero-request verification. |
| AC6 Evidence and milestone decision | blocked | Six upstream issues are recorded below. Live source and security checks were not performed because the required capabilities are absent. |

## Upstream issues

- [#2 Enforce safe collection and enrichment fetch policies](https://github.com/anton-pershin/comourat/issues/2)
- [#3 Support collecting one specified Reddit post](https://github.com/anton-pershin/comourat/issues/3)
- [#4 Provide a supported public summarization interface](https://github.com/anton-pershin/comourat/issues/4)
- [#5 Return arXiv title and abstract from ID or URL](https://github.com/anton-pershin/comourat/issues/5)
- [#6 Provide a complete article extraction result and error contract](https://github.com/anton-pershin/comourat/issues/6)
- [#7 Expose reliable enrichment success and failure outcomes](https://github.com/anton-pershin/comourat/issues/7)

## Raw observations

- The pinned comourat checkout is clean and its 79 upstream tests pass.
- Article extraction can return non-empty text, but not the required title or reason-specific failures.
- Reddit collection cannot retrieve one specified post reliably. No comments were requested during the audit.
- Enrichment can represent empty and non-empty results, but tool exceptions can become model text and produce a misleading empty result.
- Summary execution has bounded retries, but its configured agent factory and output model are private.
- arXiv title lookup exists, but abstract retrieval does not.
- No supported collection/enrichment policy can reject direct, redirect, or changed-resolution prohibited targets before connection.
- No live source or security check was marked as passed, skipped, or attempted against a private service.

## Overall decision

`blocked`. M2 cannot pass against comourat commit `3c2b092e7766ce4f4c6ad771399aaf91bf44bd39`. Resume implementation after the required upstream capabilities are available. Vesna must not implement substitutes for them.
