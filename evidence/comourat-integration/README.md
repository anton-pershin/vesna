# Comourat integration evidence

This directory records the M2 integration-contract check. The current result is **blocked** by missing comourat capabilities. The approved spec is `.internal/specs/02-comourat-integration-general-spec.md`.

## Dependency identity

- Repository: `anton-pershin/comourat`
- Commit: `3c2b092e7766ce4f4c6ad771399aaf91bf44bd39`
- Distribution metadata version: `0.0.0`
- Python: `3.12.3`
- The full commit is the source identity. The metadata version alone is not unique.

## Upstream baseline verification

The following local, editable installation was used only to verify the upstream baseline:

```sh
uv venv /tmp/vesna-m2-venv --python 3.12
uv pip install --python /tmp/vesna-m2-venv/bin/python -e /home/tony/reps/github/anton-pershin/comourat
uv pip install --python /tmp/vesna-m2-venv/bin/python pytest pytest-asyncio
cd /home/tony/reps/github/anton-pershin/comourat
/tmp/vesna-m2-venv/bin/python -m pytest
```

Result on 2026-11-03: **79 passed, 0 failed**. Raw output is in `upstream-tests.txt`. These tests establish the upstream baseline, not M2 acceptance.

## Live checks

Live article, Reddit, arXiv, and direct/redirect security checks were not performed. The required public result contracts and safe-fetch controls are absent. Each blocker has an upstream issue listed in `result.md`. Resume the Vesna adapter and live checks after the required capabilities are implemented and a new comourat commit is pinned.
