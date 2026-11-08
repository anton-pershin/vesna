# Comourat integration result

Status: **blocked — only the live Reddit preparation check fails**

## Test identity

- Vesna spec commit: `d8a4ac2`
- Vesna implementation commit: `a779d12`
- Comourat commit: `f15a0375889464d44f8ca93991fc32dd9b43a2a5`
- Comourat distribution metadata version: `0.0.0`
- Python: `3.12.3`
- Live-check date: `2026-11-08`
- Upstream CI: pass for commit `f15a037`
- Independent upstream baseline: 578 passed, 0 failed; see `upstream-tests-f15a037.txt`
- Vesna adapter/config/probe tests: 34 passed, 0 failed; see `adapter-tests.txt`
- Vesna CI: pass (run `42447004448`), including 34 adapter/config/probe tests, 578 upstream tests, and 70 JavaScript tests

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Article extraction | pass | The live PEP 8 check returned the expected title and article text. The result preserves the source URL and 40,971 text characters without summarization. |
| AC2 Reddit preparation | fail | Reddit returned HTTP 403 during specified-post collection. The adapter reported sanitized category `reddit_provider`. Enrichment and summarization were not called. |
| AC3 arXiv preparation | pass | The live `1706.03762` check returned the expected title `Attention Is All You Need` and a 1,136-character abstract. No paper body was requested. |
| AC4 Adapter and error contracts | pass | The adapter uses only public comourat interfaces and has no PWA, TTS, database, durable-job, or personal-library dependency. 34 deterministic tests pass. CI passes those tests, the 578 upstream contract/security tests at the pinned commit, and all 70 JavaScript tests. |
| AC5 URL-access security | pass | Direct and redirect IPv4/IPv6 checks rejected before connection and recorded `connections: 0`. The shared integration policy denied the configured TTS host before resolution. Redirect sources were preflighted for exact controlled targets. |
| AC6 Evidence and milestone decision | blocked | Live evidence and reproduction commands are recorded, but the required live Reddit preparation is unsuccessful. M2 cannot pass while AC2 fails. |

## Live source checks

- Article: `https://peps.python.org/pep-0008/`; expected `PEP 8` and `Style Guide for Python Code`; **pass**.
- Reddit: `https://www.reddit.com/r/announcements/comments/8xy85p/`; collection failed with HTTP 403 and category `reddit_provider`; **fail**.
- arXiv: `1706.03762`; expected `Attention Is All You Need` and `attention` in the abstract; **pass**.
- Raw sanitized outcomes are in `live-source-results.json`. URLs have no credentials, query strings, or fragments. Provider error bodies, prompts, summaries, and API keys are not included.
- The Reddit failure occurred before any LLM request. A dummy unused provider key was present only to exercise the command path; it was not used for a provider request and was not recorded.

## Live security checks

- Direct IPv4: **pass**, zero connections.
- Redirect IPv4: **pass**, zero connections.
- Direct IPv6: **pass**, zero connections.
- Redirect IPv6: **pass**, zero connections.
- Explicit TTS deny rule through the shared integration policy: **pass**.
- Raw outcomes are in `live-security-results.json`.
- The public httpbin checks were first blocked by HTTP 403. A temporary loopback-only redirect endpoint based on `server/redirect_fixture.py` was then used on the Vesna host and removed after verification.

## Upstream capability verification

All requested upstream issues are closed at `f15a037`: #2–#7, #14, and #15. The complete upstream suite passes 578 tests locally and in upstream CI. Vesna CI checks out the same full commit for its contract/security suite.

## Overall decision

`blocked` only by the live Reddit provider failure. Article extraction, arXiv preparation, adapter contracts, and URL-access security pass their required checks. M2 can pass after a live Reddit post is collected, enriched, and summarized successfully and the evidence is updated. No substitute collection path was used.
