# Vesna integration contracts

The Python adapter in `src/vesna/` uses only public comourat interfaces. It has no PWA, TTS, database, durable-job, or personal-library dependency.

## Install and test

Use Python 3.12. From the repository root:

```sh
python -m pip install './server[test]'
python -m pytest server/tests
```

`server/pyproject.toml` pins comourat commit `c9bfb1604a5286d073aaceef1513e0d7496d0e33`. CI also runs the complete upstream contract and security suite at that commit.

## Live protected-fetch security checks

Run the real direct, redirect, IPv4, IPv6, and TTS-deny checks:

```sh
PYTHONPATH=server/src python server/security_live_checks.py \
  --redirect-base https://httpbin.org/redirect-to \
  --tts-host vesna-test-tts.invalid \
  --output evidence/comourat-integration/live-security-results.json
```

The public redirect service can be unavailable. If it is, its checks are blocked rather than passed. For a controlled alternative, run `server/redirect_fixture.py` temporarily on a public test host:

```sh
python server/redirect_fixture.py --bind 0.0.0.0 --port 80
```

Then pass `--redirect-base http://HOST/redirect` to the security command. The fixture redirects only to loopback targets. Stop it after the check.

## Live source checks

Set the provider key in the named environment variable. Also set `MOURAT_REDDIT_CLIENT_ID` and `MOURAT_REDDIT_CLIENT_SECRET` for the authenticated comourat Reddit client. Do not put any credential in command arguments or evidence.

```sh
PYTHONPATH=server/src python server/source_live_checks.py \
  --article-url https://peps.python.org/pep-0008/ \
  --article-title-contains 'PEP 8' \
  --article-text-contains 'Style Guide for Python Code' \
  --reddit-url https://www.reddit.com/r/announcements/comments/8xy85p/ \
  --reddit-title-contains 'announcements' \
  --arxiv-reference 1706.03762 \
  --arxiv-title-contains 'Attention Is All You Need' \
  --arxiv-abstract-contains 'attention' \
  --tts-host vesna-test-tts.invalid \
  --openai-model gpt-4o-mini \
  --output evidence/comourat-integration/live-source-results.json
```

`--api-key-env` selects the environment variable; its default is `OPENAI_API_KEY`. `--openai-base-url` supports an OpenAI-compatible provider and normalizes a full `/chat/completions` endpoint. For CAILA, use `--api-key-env CAILA_API_KEY --openai-base-url https://caila.io/api/openai/v1/chat/completions --openai-model gpt-6-luna`. The output contains outcomes and metadata lengths, not provider errors, prompts, summaries, credentials, or signed query parameters. All three live source checks pass. Authenticated Reddit collection uses `PrawRedditSubmissionClient`, enrichment completes with `no_context`, and summarization returns a non-empty result through the OpenAI-compatible Chat Completions provider.
