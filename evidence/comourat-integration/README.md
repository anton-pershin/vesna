# Comourat integration evidence

This directory records M2 integration-contract checks. The current result is **blocked** by arXiv issues #14 and #15 and by live checks that have not run. The approved spec is `.internal/specs/02-comourat-integration-general-spec.md`.

## Current dependency identity

- Repository: `anton-pershin/comourat`
- Commit: `d82a29f87b858024615f8f56c4059c11b043bdd9`
- Distribution metadata version: `0.0.0`
- Python: `3.12.3`
- The full commit is the source identity. The metadata version alone is not unique.

## Latest upstream verification

A temporary clean clone was used so the original comourat checkout remained unchanged:

```sh
git clone https://github.com/anton-pershin/comourat.git /tmp/comourat-review
uv venv /tmp/comourat-review-venv --python 3.12
uv pip install --python /tmp/comourat-review-venv/bin/python \
  -e /tmp/comourat-review pytest pytest-asyncio
cd /tmp/comourat-review
/tmp/comourat-review-venv/bin/python -m pytest
```

Result on 2026-11-06: **553 passed, 0 failed**. Raw output is in `upstream-tests-d82a29f.txt`. GitHub's quality check also passes for this commit.

## Previous upstream verification

The earlier baseline used commit `3c2b092e7766ce4f4c6ad771399aaf91bf44bd39` and passed **79 tests**. Its raw output is in `upstream-tests.txt`. This history is retained because it records the original six blockers.

## Live checks

Live article, Reddit, arXiv, and direct/redirect security checks have not run. Article, Reddit, and safe-fetch public contracts are now sufficient to resume those parts of the adapter and live-check work. Full M2 acceptance still requires the arXiv fixes in #14 and #15 and all required live checks.
