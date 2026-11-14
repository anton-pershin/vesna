# Vesna

Vesna is a mobile-first PWA for preparing and listening to public articles and UTF-8 Markdown documents. The application provides authenticated article and Markdown input, a saved library, durable server-side preparation, real local English TTS, complete MP3 audio, paragraph timings, and online read-along playback. M4 adds focused A1 screens, a persistent bottom playback bar, accessible source and item actions, and safe item deletion.

M1 playback feasibility, the M2 comourat integration contract, and M3 are complete. M4 is **Done**, and the implementation PR is ready to merge.

## Application architecture

One development machine runs three processes:

- `vesna-api`: FastAPI static shell, authentication, library, jobs, safe item deletion, source data, and authenticated audio byte ranges.
- `vesna-worker`: one durable preparation worker using SQLite, private filesystem artifacts, comourat article extraction, Markdown text extraction, and FFmpeg assembly.
- `vesna-tts`: a loopback-only adapter for the selected local Piper voice.

The phone reaches only the API through a temporary Cloudflare Quick Tunnel HTTPS origin. TTS listens only on loopback and is never exposed through the tunnel. See [`deploy/README.md`](deploy/README.md) for installation and operation.

## Automated checks

Use Node.js 24, Python 3.12, `uv`, FFmpeg, and FFprobe. From the repository root:

```sh
npm test
npm run check:syntax

UV_PROJECT_ENVIRONMENT=/tmp/vesna-venv uv sync --project server --extra test --extra tts --locked
/tmp/vesna-venv/bin/python -m pytest server/tests
```

Deterministic tests use controlled fixtures and do not require credentials, external services, or a phone. CI also runs the pinned comourat contract and security suite. Real source, TTS, tunnel, browser, and device checks are separate explicit procedures.

## Browser module source

`public/modules/` is the canonical source for shared browser modules. Tests import these exact served files. Do not maintain a second module source. `public/app.js` composes the M4 screens and playback bar, and `public/sw.js` owns its public-shell-only service-worker behavior.

Private API responses, authentication responses, source content, and prepared artifacts must not enter the public shell cache. Playback state is keyed by item and prepared version.

## Isolated M1 regression probe

The synthetic M1 probe is in `probe/`, outside the current application. It uses the canonical shared modules through its runtime server. Serve it on a separate origin:

```sh
npm run serve:probe
cloudflared tunnel --url http://127.0.0.1:8081
```

Use the printed HTTPS URL only for the probe. Select **Prepare offline fixture** before offline tests. See [`probe/README.md`](probe/README.md) and the M3 evidence procedure. Probe results do not establish real-item offline readiness.

## Server and integration documentation

See [`server/README.md`](server/README.md) for process commands, environment variables, password setup, durability, and publication contracts. Comourat remains pinned to `c9bfb1604a5286d073aaceef1513e0d7496d0e33`; the application uses only its public article-extraction path through the M2 adapter.

## Evidence

- M1: [`evidence/android-playback/`](evidence/android-playback/)
- M2: [`evidence/comourat-integration/`](evidence/comourat-integration/)
- M3: [`evidence/first-usable-listening-application/`](evidence/first-usable-listening-application/)
- M4: [`evidence/practical-mobile-interface/`](evidence/practical-mobile-interface/)

Do not commit passwords, password hashes, session cookies, private TTS addresses, models, runtime data, or unintended private content.
