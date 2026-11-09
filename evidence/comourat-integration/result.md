# Comourat integration result

Status: **blocked — authenticated Reddit collection passes; enrichment and summarization remain**

## Test identity

- Vesna spec commit: `d8a4ac2`
- Vesna implementation commit: `a779d12`
- Comourat commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Comourat distribution metadata version: `0.0.0`
- Python: `3.12.3`
- Live-check date: `2026-11-09`
- Upstream CI: pass for commit `c9bfb160`
- Independent upstream baseline: 619 passed, 0 failed; see `upstream-tests-c9bfb160.txt`
- Vesna adapter/config/probe tests: 34 passed, 0 failed; see `adapter-tests.txt`
- Vesna CI: pass (run `42447004448`), including 34 adapter/config/probe tests, 578 upstream tests, and 70 JavaScript tests

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Article extraction | pass | The live PEP 8 check returned the expected title and article text. The result preserves the source URL and 40,971 text characters without summarization. |
| AC2 Reddit preparation | blocked pending enrichment and summarization | Authenticated collection through public `PrawRedditSubmissionClient` returns the specified post with its canonical permalink. Issue #18 is closed and 619 upstream tests pass. A complete live preparation still requires successful enrichment and summarization using an OpenAI-compatible provider. |
| AC3 arXiv preparation | pass | The live `1706.03762` check returned the expected title `Attention Is All You Need` and a 1,136-character abstract. No paper body was requested. |
| AC4 Adapter and error contracts | pass | The adapter uses only public comourat interfaces and has no PWA, TTS, database, durable-job, or personal-library dependency. 34 deterministic tests pass. CI passes those tests, the 619 upstream contract/security tests at the pinned commit, and all 70 JavaScript tests. |
| AC5 URL-access security | pass | Direct and redirect IPv4/IPv6 checks rejected before connection and recorded `connections: 0`. The shared integration policy denied the configured TTS host before resolution. Redirect sources were preflighted for exact controlled targets. |
| AC6 Evidence and milestone decision | blocked | Live evidence and reproduction commands are recorded, but enrichment and summarization have not completed. M2 cannot pass while AC2 is blocked. |

## Live source checks

- Article: `https://peps.python.org/pep-0008/`; expected `PEP 8` and `Style Guide for Python Code`; **pass**.
- Reddit: `https://www.reddit.com/r/announcements/comments/8xy85p/`; authenticated collection through `PrawRedditSubmissionClient` **passes** and returns the canonical post permalink. Enrichment and summarization have not run because an OpenAI-compatible provider key is not configured. No credential was printed or committed.
- arXiv: `1706.03762`; expected `Attention Is All You Need` and `attention` in the abstract; **pass**.
- Raw sanitized outcomes are in `live-source-results.json` (article, earlier Reddit failure, and arXiv) and `live-reddit-collection-result.json` (authenticated collection pass). URLs have no credentials, query strings, or fragments. Provider error bodies, prompts, summaries, and API keys are not included.
- The earlier unauthenticated failure occurred before any LLM request. The latest authenticated collection used the caller-provided Reddit app without exposing either credential.

## Live security checks

- Direct IPv4: **pass**, zero connections.
- Redirect IPv4: **pass**, zero connections.
- Direct IPv6: **pass**, zero connections.
- Redirect IPv6: **pass**, zero connections.
- Explicit TTS deny rule through the shared integration policy: **pass**.
- Raw outcomes are in `live-security-results.json`.
- The public httpbin checks were first blocked by HTTP 403. A temporary loopback-only redirect endpoint based on `server/redirect_fixture.py` was then used on the Vesna host and removed after verification.

## Upstream capability verification

All requested upstream issues are closed, including #18. The complete upstream suite passes 619 tests locally and in upstream CI at `c9bfb160`. Vesna now pins and checks out the same full commit for its contract/security suite.

## Overall decision

`blocked` pending live Reddit enrichment and summarization. Authenticated collection, article extraction, arXiv preparation, adapter contracts, and URL-access security pass their required checks. M2 can pass after the collected post is enriched and summarized successfully through the public comourat interfaces and the evidence is updated. No substitute collection path was used.
