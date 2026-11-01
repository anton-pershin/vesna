# Vesna Android playback probe

A dependency-light static PWA for the M1 Android playback feasibility gate. It ships one complete, synthetic 30-minute MP3 fixture, 12 timed paragraphs, offline caching, state restoration, read-along highlighting, and Media Session controls.

## Run locally

No packages are required. From the repository root:

```sh
npm test
npm run serve
```

Open `http://localhost:8080` for desktop checks. A real PWA installation requires an HTTPS origin; deploy the contents of `public/` to an HTTPS static host before using the phone procedure. The local HTTP server is only for automated and desktop checks.

## Offline check

1. Open the HTTPS deployment in Chrome.
2. Select **Prepare offline fixture** and wait for **Offline readiness: complete**.
3. Confirm the service worker is active, then disable Wi-Fi and mobile data.
4. Close and reopen the installed PWA.
5. Verify the fixture reader, audio, seeking, speed, paragraph highlighting, and restored position are available.

The phone-specific evidence procedure is in [`evidence/android-playback/README.md`](evidence/android-playback/README.md). The current result template is [`evidence/android-playback/result.md`](evidence/android-playback/result.md).
