# Comourat integration evidence

This directory records M2 integration-contract checks. Article, arXiv, adapter, and protected-fetch checks pass. Unauthenticated Reddit collection returns HTTP 403, while authenticated PRAW succeeds. Comourat issue #18 requests the required authenticated public interface, so M2 remains blocked.

## Dependency identity

- Repository: `anton-pershin/comourat`
- Commit: `f15a0375889464d44f8ca93991fc32dd9b43a2a5`
- Distribution metadata version: `0.0.0`
- Python: `3.12.3`
- The full commit is the source identity. The metadata version alone is not unique.

## Upstream verification

A temporary clean clone was used so the original comourat checkout remained unchanged:

```sh
git clone https://github.com/anton-pershin/comourat.git /tmp/comourat-review
git -C /tmp/comourat-review checkout f15a0375889464d44f8ca93991fc32dd9b43a2a5
uv venv /tmp/comourat-review-venv --python 3.12
uv pip install --python /tmp/comourat-review-venv/bin/python \
  -e /tmp/comourat-review pytest pytest-asyncio
cd /tmp/comourat-review
/tmp/comourat-review-venv/bin/python -m pytest
```

Result on 2026-11-08: **578 passed, 0 failed**. Raw output is in `upstream-tests-f15a037.txt`. GitHub's quality check also passes for this commit.

## Vesna verification

Install the pinned adapter and run its tests:

```sh
python -m pip install './server[test]'
python -m pytest server/tests
```

Result: **34 passed, 0 failed**. Raw output is in `adapter-tests.txt`. CI additionally checks out the full comourat commit above and runs all 578 upstream contract/security tests.

## Live checks

Commands and configuration are documented in `server/README.md`. Outputs are sanitized:

- `live-source-results.json`: article and arXiv pass; Reddit fails with `reddit_provider`.
- `live-security-results.json`: direct and redirect IPv4/IPv6 pass with zero drained connections, and the shared TTS deny rule passes.

The live article source is PEP 8. The arXiv reference is `1706.03762`. The Reddit source is the public announcements post `8xy85p`. Expected-content assertions are part of the commands. No API key, provider error body, prompt, summary, or signed query parameter is recorded.

## Previous baselines

- Commit `d82a29f87b858024615f8f56c4059c11b043bdd9`: **553 passed**, in `upstream-tests-d82a29f.txt`.
- Commit `3c2b092e7766ce4f4c6ad771399aaf91bf44bd39`: **79 passed**, in `upstream-tests.txt`.
