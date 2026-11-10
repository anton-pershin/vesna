# Vesna M3 server

This directory contains the authenticated FastAPI application, durable SQLite preparation worker, private filesystem artifact store, FFmpeg/FFprobe audio assembly, loopback-only TTS adapter, and the M2 comourat integration contracts. The browser application is served from `public/`; prepared artifacts and SQLite records are never mounted as static files.

The article path composes `ComouratAdapter` with only comourat's public `PageFetcher`. It does not construct Reddit, arXiv, enrichment, summarization, or LLM collaborators and needs none of their credentials. Markdown parsing is local, produces inert plain paragraphs, preserves the original bytes, and never retrieves linked resources.

## Requirements, installation, and tests

Use Python 3.12 and install FFmpeg and FFprobe as system dependencies. No real TTS engine is selected or downloaded by this repository.

```sh
python -m pip install './server[test]'
python -m pytest server/tests
```

Comourat remains pinned to `c9bfb1604a5286d073aaceef1513e0d7496d0e33`. FastAPI, Uvicorn, multipart parsing, and the HTTP test client have pinned application/test versions in `pyproject.toml`. Deterministic tests use fake source/TTS fixtures and controlled loopback listeners only. The real assembly tests require `ffmpeg` and `ffprobe` on `PATH`.

## Password setup

Passwords are supplied only to the interactive helper, which uses `getpass` and never accepts a password command argument:

```sh
vesna-password-hash
```

Store the resulting `scrypt$...` value in externally managed configuration for `VESNA_PASSWORD_HASH`. Only the API process needs this hash. Do not commit it, place it in browser assets, or include it in logs/evidence. The helper prints a hash, not the password.

## Processes

Run three separate processes from the same configuration directory:

```sh
vesna-api --host 127.0.0.1 --port 8000
vesna-worker
vesna-tts --host 127.0.0.1 --port 8765
```

`vesna-worker --once` claims at most one durable job, which is useful for controlled checks. Run exactly one worker in M3. `vesna-tts` rejects every non-loopback bind address. The TTS engine command uses `{input}` and `{output}` placeholders for a UTF-8 text-file path and WAV-output path. It is split into argv and executed directly without a shell; source text is never placed in process arguments. Configure only the worker with the private TTS URL and expose only the API port through the Quick Tunnel.

The API uses the configured `VESNA_PUBLIC_ORIGIN` for strict mutation `Origin` checks. It ignores Host and forwarded headers for security decisions and never constructs artifact URLs from them. A changed Quick Tunnel URL is a new origin and requires a corresponding configuration change and a new sign-in.

## Environment variables

All values are read from the process environment; there is no implicit credential lookup. Defaults shown below are non-secret development defaults.

| Variable | Used by | Meaning / default |
| --- | --- | --- |
| `VESNA_PUBLIC_ORIGIN` | API | **Required for API.** Exact public HTTP(S) origin, without path/query/fragment. Use the temporary HTTPS tunnel origin for remote access. |
| `VESNA_PASSWORD_HASH` | API | **Required for API.** Externally generated stdlib-scrypt hash. |
| `VESNA_DATABASE` | API, worker | SQLite path; default `var/vesna.sqlite3`. |
| `VESNA_ARTIFACT_ROOT` | API, worker | Private artifact directory; default `var/artifacts`; must not be inside the static directory. |
| `VESNA_STATIC_DIR` | API | Optional static-shell override; defaults to repository `public/` when present. |
| `VESNA_SESSION_TTL_SECONDS` | API | Server-side session lifetime; default `604800`. |
| `VESNA_UPLOAD_MAX_BYTES` | API | Maximum Markdown file bytes; default `1048576`; the limit is inclusive. |
| `VESNA_REQUEST_MAX_BYTES` | API | Maximum complete mutation request; default `1261568`; must exceed upload limit by at least 4096 bytes. |
| `VESNA_MAX_PARAGRAPHS` | worker | Maximum source paragraphs; default `500`. |
| `VESNA_MAX_PARAGRAPH_CHARS` | worker | Maximum characters per paragraph; default `20000`. |
| `VESNA_ARTICLE_CONNECT_TIMEOUT` | worker | comourat connection timeout seconds; default `10`. |
| `VESNA_ARTICLE_READ_TIMEOUT` | worker | comourat read timeout seconds; default `30`. |
| `VESNA_ARTICLE_OVERALL_TIMEOUT` | worker | comourat overall deadline seconds; default `60`. |
| `VESNA_TTS_URL` | worker | Private HTTP URL with literal `127.0.0.1` or `::1` and a synthesis path; default `http://127.0.0.1:8765/synthesize`. Hostnames, HTTPS, credentials, and query strings are rejected. |
| `VESNA_TTS_CONNECT_TIMEOUT` | worker | TTS connection timeout seconds; default `2`. |
| `VESNA_TTS_OVERALL_TIMEOUT` | worker | Overall deadline for each sequential TTS request; default `120`. |
| `VESNA_TTS_RESPONSE_MAX_BYTES` | worker, TTS | Maximum WAV response/output bytes; default `25000000`. |
| `VESNA_TTS_ENGINE_COMMAND` | TTS | **Required for TTS.** Local argv command containing `{input}` and `{output}` placeholders. |
| `VESNA_TTS_ENGINE_TIMEOUT` | TTS | Local engine process deadline seconds; default `120`. |
| `VESNA_WORKER_POLL_SECONDS` | worker | Idle database poll interval; default `0.25`. |
| `VESNA_WORKER_LEASE_SECONDS` | worker | Renewable transactional claim lease; default `300`. |
| `VESNA_VOICE_ID` | worker | Non-secret selected voice/configuration identity recorded in manifests; default `local-default`. Set this to the evaluated live configuration identity. |
| `VESNA_FFMPEG` | worker | FFmpeg executable/argv; default `ffmpeg`. |
| `VESNA_FFPROBE` | worker | FFprobe executable/argv; default `ffprobe`. |

The API additionally accepts `--host` and `--port`; TTS accepts loopback-only `--host` and `--port`. Keep the database and artifact root outside `public/` and on durable local storage.

## Durability and publication

Schema migrations run at process construction. Accepted items and jobs are committed before the API returns `202`. The worker uses `BEGIN IMMEDIATE` claims and leases, records source and per-paragraph speech stages, and resumes expired claims after interruption. Retries are allowed only for failed items, keep the same item/version candidate, and reuse a stage only when its source, version, paragraph text, voice identity, and artifact hashes match.

Each paragraph WAV is encoded and probed. FFmpeg concatenates the encoded MP3 segments; timings use their encoded durations and are checked against the final FFprobe duration. A manifest binds item, version, voice, text, timings, audio hashes, and paragraph identities. Files are verified in staging and the version directory is atomically renamed before the database ready pointer is committed. Candidate/staging artifacts are never API-visible. Failure leaves any previously published version intact.

The original Markdown, listening text, timings, and audio require the same opaque SQLite-backed session. Cookies are `Secure`, `HttpOnly`, `SameSite=Strict`, host-only, and invalidated on sign-out. Audio supports full `200`, single-range `206`, unsatisfiable-range `416`, and HEAD responses. Private API/artifact responses use no-store cache headers.

## Explicit live checks

The M2 protected-fetch and source checks remain separate explicit procedures; they are not run by deterministic tests:

```sh
PYTHONPATH=server/src python server/security_live_checks.py \
  --redirect-base https://httpbin.org/redirect-to \
  --tts-host vesna-test-tts.invalid \
  --output evidence/comourat-integration/live-security-results.json
```

The legacy `source_live_checks.py` still supports the M2 Reddit/arXiv/LLM checks when explicitly invoked with externally supplied credentials. Those collaborators and credentials are not part of M3 application composition. Do not interpret deterministic fake-engine tests as live English-speech, voice-evaluation, public-article, tunnel, or target-phone acceptance results.
