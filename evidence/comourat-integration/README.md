# Comourat integration evidence

This directory records M2 integration-contract checks. Article, arXiv, adapter, protected-fetch, and complete authenticated Reddit preparation checks pass. M2 is complete.

## Dependency identity

- Repository: `anton-pershin/comourat`
- Commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Distribution metadata version: `0.0.0`
- Python: `3.12.3`
- The full commit is the source identity. The metadata version alone is not unique.

## Upstream verification

A temporary clean clone was used so the original comourat checkout remained unchanged:

```sh
git clone https://github.com/anton-pershin/comourat.git /tmp/comourat-review
git -C /tmp/comourat-review checkout c9bfb1604a5286d073aaceef1513e0d7496d0e33
uv venv /tmp/comourat-review-venv --python 3.12
uv pip install --python /tmp/comourat-review-venv/bin/python \
  -e /tmp/comourat-review pytest pytest-asyncio
cd /tmp/comourat-review
/tmp/comourat-review-venv/bin/python -m pytest
```

Result on 2026-11-09: **619 passed, 0 failed**. Raw output is in `upstream-tests-c9bfb160.txt`. GitHub's quality check also passes for this commit.

## Vesna verification

Install the pinned adapter and run its tests:

```sh
python -m pip install './server[test]'
python -m pytest server/tests
```

Result: **36 passed, 0 failed**. Raw output is in `adapter-tests.txt`. CI additionally checks out the full comourat commit above and runs all 619 upstream contract/security tests.

## Live checks

Commands and configuration are documented in `server/README.md`. Outputs are sanitized:

- `live-source-results.json`: article, arXiv, and complete Reddit preparation pass. Reddit enrichment returns successful `no_context`, and the summary is non-empty.
- `live-reddit-collection-result.json`: authenticated collection passes through the public comourat client.
- `live-security-results.json`: direct and redirect IPv4/IPv6 pass with zero drained connections, and the shared TTS deny rule passes.

The live article source is PEP 8. The arXiv reference is `1706.03762`. The Reddit source is the public announcements post `8xy85p`. Expected-content assertions are part of the commands. No API key, provider error body, prompt, summary, or signed query parameter is recorded.

## Previous baselines

- Commit `d82a29f87b858024615f8f56c4059c11b043bdd9`: **553 passed**, in `upstream-tests-d82a29f.txt`.
- Commit `3c2b092e7766ce4f4c6ad771399aaf91bf44bd39`: **79 passed**, in `upstream-tests.txt`.
