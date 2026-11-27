# Vesna

Vesna is a mobile-first PWA for preparing and listening to public articles and UTF-8 Markdown documents. The application provides authenticated article and Markdown input, a saved library, durable server-side preparation, real local English TTS, complete MP3 audio, paragraph timings, and read-along playback. M4 adds focused A1 screens, a persistent bottom playback bar, accessible source and item actions, and safe item deletion. Issue #13 adds explicit per-item downloads and offline library/playback for existing article and Markdown items; target-phone acceptance remains a separate recorded check.

M1 playback feasibility, the M2 comourat integration contract, M3, and M4 are complete. M6 is implemented incrementally by issue #13 before M5; later source types must preserve this offline contract.

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

Private API responses, authentication responses, and source content must not enter browser caches. Prepared manifests, text, timings, and audio may enter only a separate per-item cache after an explicit, complete download. The public shell cache never contains them. Playback state is keyed by item and prepared version.

## Offline library and playback

1. Sign in online and open a ready item.
2. Select **Download for offline use** and wait for **Available offline**. A persistent-storage warning means that the item is usable now but the browser may remove it later.
3. Close the installed PWA, disable Wi-Fi and mobile data, and reopen it from the same origin.
4. Open the downloaded item and use the normal reader and playback controls. Content input, source inspection, retry, and server deletion require connectivity.
5. **Remove offline download** removes only the device copy and preserves the server item. Confirmed server-item deletion also removes its local download on the requesting device.

Downloads are explicit and are never automatic. Sign-out and session expiration clear online private screens but do not erase device downloads; remove a download explicitly to revoke its offline availability. Browser data clearing, uninstallation, operating-system storage removal, or a changed Quick Tunnel origin can remove or isolate the shell, downloads, and playback state. No permanent-retention guarantee is made. A missing or partial download is never presented as offline-ready.

`public/modules/downloads.js` coordinates staged, hash-verified publication. `public/sw.js` serves only resources in the published offline index, including audio byte ranges. The server exposes authenticated version manifests and preserves raw text/timings JSON bytes so client hashes cover the exact transmitted artifacts. See `.internal/specs/13-offline-library-and-playback-general-spec.md` and `evidence/offline-library-and-playback/`.

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
- Issue #13 offline downloads: [`evidence/offline-library-and-playback/`](evidence/offline-library-and-playback/)

Do not commit passwords, password hashes, session cookies, private TTS addresses, models, runtime data, or unintended private content.
