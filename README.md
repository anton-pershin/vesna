# Vesna Android playback probe

A dependency-light static PWA for the M1 Android playback feasibility gate. It ships one complete, synthetic 30-minute MP3 fixture, 12 timed paragraphs, offline caching, state restoration, read-along highlighting, and Media Session controls.

## Run locally

No packages are required. From the repository root:

```sh
npm test
npm run serve
```

Open `http://localhost:8080` for desktop checks. A real PWA installation requires an HTTPS origin. The local HTTP server is only for automated and desktop checks.

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

## Offline check

1. Open the HTTPS deployment in Chrome.
2. Record the **Probe build** value shown on the page.
3. Select **Prepare offline fixture** and wait for **Offline readiness: complete**.
4. Confirm the service worker is active, then disable Wi-Fi and mobile data.
5. Close and reopen the installed PWA.
6. Verify the fixture reader, audio, seeking, speed, paragraph highlighting, and restored position are available.

For the state-restoration check, seek to a non-zero position, select 2×, and pause before closing the PWA. After reopening, compare the saved position in the status with the native audio position and the separate **Position** control. If restoration fails, record the complete status message and the **Probe build** value. Do not clear the saved state before you record this information.

The phone-specific evidence procedure is in [`evidence/android-playback/README.md`](evidence/android-playback/README.md). The current result is [`evidence/android-playback/result.md`](evidence/android-playback/result.md).
