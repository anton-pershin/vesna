# Vesna Android playback probe

A dependency-light static PWA for the M1 Android playback feasibility gate. It ships one complete, synthetic 30-minute MP3 fixture, 12 timed paragraphs, offline caching, state restoration, read-along highlighting, and Media Session controls.

## Run locally

No npm packages are required. CI uses Node.js 24 and Python 3.12; use these versions for matching local results. Python uses only the standard library. From the repository root:

```sh
npm test
npm run serve
```

Open `http://localhost:8080` for desktop checks. A real PWA installation requires an HTTPS origin. The local HTTP server is only for automated and desktop checks.

## Browser module source

`public/modules/` is the canonical source for shared browser modules. Tests import these exact served files. Do not maintain a second copy under `src/`. `public/app.js` composes the page, and `public/sw.js` owns service-worker behavior.

CI runs syntax checks, deployed-module import checks, and the test suite for pull requests to `main` and pushes to `main`. The `test` check should be required by the repository's `main` branch protection settings.

## Comourat integration

The M2 Python adapter and its deterministic tests are in `server/`. See [`server/README.md`](server/README.md) for installation, CI, and explicit live-check commands. Live outputs and current acceptance results are in [`evidence/comourat-integration/`](evidence/comourat-integration/).

## Deploy to HTTPS

Deploy the contents of `public/` to an HTTPS static host. The host must support single HTTP byte ranges. Audio seeks can fail if a range request receives the complete file with status `200` instead of the requested bytes with status `206`.

The included static server supports byte ranges and optional TLS:

```sh
python3 scripts/static_server.py \
  --bind 0.0.0.0 \
  --port 443 \
  --directory public \
  --certificate /path/to/fullchain.pem \
  --key /path/to/privkey.pem
```

Keep certificate files outside the repository. To check an audio deployment, run:

```sh
curl -D - -o /dev/null -H 'Range: bytes=1000-1999' \
  https://example.test/fixtures/audio/fixture.mp3
```

The response must have status `206 Partial Content`, `Content-Range: bytes 1000-1999/1805288`, and `Content-Length: 1000`.

The current HTTPS service is an ad-hoc M1 probe deployment. It is not the future production application architecture. Later implementation specs must define reproducible application and deployment configuration.

## Offline check

1. Open the HTTPS deployment in Chrome.
2. Record the **Probe build** value shown on the page.
3. Select **Prepare offline fixture** and wait for **Offline readiness: complete**.
4. Confirm the service worker is active, then disable Wi-Fi and mobile data.
5. Close and reopen the installed PWA.
6. Verify the fixture reader, audio, seeking, speed, paragraph highlighting, and restored position are available.

For the state-restoration check, seek to a non-zero position, select 2×, and pause before closing the PWA. After reopening, compare the saved position in the status with the native audio position and the separate **Position** control. If restoration fails, record the complete status message and the **Probe build** value. Do not clear the saved state before you record this information.

The phone-specific evidence procedure is in [`evidence/android-playback/README.md`](evidence/android-playback/README.md). The current result is [`evidence/android-playback/result.md`](evidence/android-playback/result.md).
