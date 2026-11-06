# Comourat integration result

Status: **blocked — two arXiv contract issues remain; live checks are not performed**

## Test identity

- Vesna spec commit: `d8a4ac2`
- Comourat commit under review: `d82a29f87b858024615f8f56c4059c11b043bdd9`
- Comourat distribution metadata version: `0.0.0`
- Python: `3.12.3`
- Check date: `2026-11-06`
- Upstream CI: pass for commit `d82a29f`
- Independent temporary-clone baseline: 553 passed, 0 failed; see `upstream-tests-d82a29f.txt`
- Previous baseline at `3c2b092`: 79 passed, 0 failed; see `upstream-tests.txt`

## Acceptance record

| Criterion | Result | Current observation |
|---|---|---|
| AC1 Article extraction | blocked pending adapter and live check | Issue #6 is closed. The public article API returns title, source URL, and text with categorized errors and bounded operation time. No Vesna adapter or live result is claimed yet. |
| AC2 Reddit preparation | blocked pending adapter and live check | Issues #3, #4, and #7 are closed. Public specified-post collection, enrichment outcomes, and summarization outcomes exist. No live Reddit preparation result is claimed yet. |
| AC3 arXiv preparation | blocked | Issue #5 is closed, but provider Atom error entries can still become successful paper results. Issue #14 is open. The nominal overall deadline does not strictly bound DNS, redirects, or trickled responses. Issue #15 is open. |
| AC4 Adapter and error contracts | blocked | Article and Reddit public contracts are sufficient for a Vesna adapter. arXiv false-success and overall-deadline behavior prevent a complete truthful adapter contract. |
| AC5 URL-access security | blocked pending live security checks | Issue #2 is closed. Protected direct, redirect, resolution, and actual-socket controls exist for collection and enrichment. Required live controlled-listener checks have not run. |
| AC6 Evidence and milestone decision | blocked | Latest source and 553-test evidence are recorded. Two upstream blockers and all required live checks remain open. |

## Implemented upstream capabilities

The following issues are closed and their public capabilities are present in commit `d82a29f`:

- [#2 Safe collection and enrichment fetch policies](https://github.com/anton-pershin/comourat/issues/2)
- [#3 Single Reddit post retrieval](https://github.com/anton-pershin/comourat/issues/3)
- [#4 Public summarization interface](https://github.com/anton-pershin/comourat/issues/4)
- [#5 arXiv title and abstract](https://github.com/anton-pershin/comourat/issues/5)
- [#6 Article result and error contract](https://github.com/anton-pershin/comourat/issues/6)
- [#7 Reliable enrichment outcomes](https://github.com/anton-pershin/comourat/issues/7)

## Remaining upstream blockers

- [#14 Handle arXiv Atom error entries explicitly](https://github.com/anton-pershin/comourat/issues/14): an HTTP 200 Atom error entry can become a paper titled `Error`. The client must distinguish documented provider errors from valid papers, including a valid paper whose title is `Error`.
- [#15 Enforce a hard overall deadline for arXiv metadata requests](https://github.com/anton-pershin/comourat/issues/15): scalar Requests timeouts and elapsed-time checks do not strictly bound blocking DNS, redirects, retries, or a steadily trickled response.

## Raw observations

- Latest `main` is `d82a29f87b858024615f8f56c4059c11b043bdd9`; its GitHub quality check passes.
- A clean temporary clone passes 553 tests on Python 3.12.3. This is a larger baseline than the previous 79-test checkout.
- Article extraction now exposes the required result and categorized error contracts.
- Reddit collection accepts specified post URLs/IDs without comments. Enrichment and summarization expose separate success, empty, and failure outcomes.
- Protected fetch validates complete DNS answers and binds connections to validated addresses for article and enrichment paths.
- arXiv accepts ID, abstract URL, and PDF URL inputs, but the two remaining contract defects prevent acceptance.
- No article, Reddit, arXiv, or direct/redirect security live check was performed or marked as passed during this review.

## Overall decision

`blocked`. Article, Reddit, and safe-fetch adapter work can resume. Full M2 acceptance still requires issues #14 and #15 to be implemented, a new comourat commit to be pinned, and every required live source and security check to pass.
