# First usable listening application result

Status: **pass — M3 first usable listening application is complete**

## Test identity

- Vesna spec commit: `5d892dc`
- Final application and probe implementation commit: `8612655`
- Clean-checkout reproduction commit: `b7937cf`
- Comourat commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Python: `3.12.3`
- Cloudflared: `2026.10.7`
- FFmpeg: `6.1.1-3ubuntu5`
- TTS: `piper-tts==1.8.0`, `onnxruntime==1.31.1`
- Selected voice: `en_US-joe-medium`, revision `cf910fb59f1d79ab3b625a63993a108751c6c25d`
- Voice identity: `piper-en-us-joe-medium-cf910fb5`
- Live Chromium: `141.0.7390.37`
- Hosted CI: pass, run `42954896274` at head `8612655`
- Phone operating system: `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`
- Phone Chrome: `138.0.7204.157`
- Temporary application origin: `https://track-ruling-wifi-absence.trycloudflare.com`
- Temporary isolated-probe origin: `https://zip-shortly-str-robertson.trycloudflare.com`
- Final isolated probe build: `2026-11-11-quality-r7`

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Authentication and input validation | pass | The locked deterministic suite covers authentication, cookies, Origin/Host behavior, upload limits, UTF-8, prohibited inputs, XSS, and request limits. Live sign-in, bad-password denial, sign-out, and cross-origin mutation denial also pass. |
| AC2 Article and Markdown content and library transparency | pass | `live-source-results.json` records passing Example Domain and three-paragraph Markdown preparation. Expected article text is present, and original Markdown matches the uploaded bytes. The user also inspected both source types on the phone. |
| AC3 Durable preparation and basic retries | pass | Deterministic restart, claim, lease, concurrency, stage-reuse, and retry tests pass. The live submitting client disconnected before both jobs completed; fresh authenticated sessions retrieved the ready results. |
| AC4 Voice evaluation and real local TTS | pass | Joe and LJ Speech each completed three matched real-generation runs. Samples, hashes, speed, memory, and selection rationale are recorded. The user selected Joe, and both live items used real loopback Piper TTS. |
| AC5 Audio assembly and ready publication | pass | Deterministic FFmpeg consistency and corruption tests pass. Both live source items produced version-matched text, timings, and MP3 audio and played in real Chromium and on the phone. |
| AC6 Playback, read-along behavior, and mobile accessibility | pass | `device-results.md` records a fully passing real-item procedure and isolated probe procedure, including 30-minute locked-screen offline playback, update preservation, accessibility, and OS/Chrome identity. Lock-screen and headset controls were unavailable; AC9 permits unavailable controls when the procedure and observation are recorded. |
| AC7 Secure remote access and deployment isolation | pass | The user installed and used the application over mobile data. Public Quick Tunnel API checks, loopback listeners, unauthenticated denial, cache exclusion, and direct/redirect zero-connection security checks pass. TTS is not exposed publicly. |
| AC8 Reproducible deployment and deterministic CI | pass | Clean checkout `b7937cf` reproduces locked dependencies, verified model, real three-process deployment, both live sources, and Chromium playback. Systemd units pass isolated syntax/executable validation. Hosted CI run `42954896274` passes 161 Python, 619 comourat, and 120 JavaScript tests. |
| AC9 Evidence and milestone decision | pass | Sanitized automated, live, voice, security, browser, clean-checkout, hosted-CI, and target-phone records exist with reproduction instructions and explicit outcomes. No required check remains pending or blocked. |

## Automated and hosted results

- `automated-python.txt`: **161 passed, 0 failed**.
- `automated-javascript.txt`: **120 passed, 0 failed**, including syntax checks.
- `ci-results.json`: hosted run `42954896274` at head `8612655`, **pass**, with 161 Python application tests, 619 pinned comourat tests, and 120 JavaScript tests.
- No deterministic check used external services, credentials, or target-phone access.

## Live source and browser results

- `live-source-results.json`: article and Markdown pass through the temporary public HTTPS application. Both include real audio hashes and authenticated `206`/`416` range checks. Markdown confirms continued preparation after disconnect and server-side sign-out.
- `browser-result.json`: real Chromium decodes and plays both live items, navigates paragraphs, changes speed, restores position and speed, reports no horizontal overflow, and records zero private responses in Cache Storage.
- `browser-m3.png`: sanitized real-item browser capture with public test content only.
- `clean-checkout-result.json`, `clean-checkout-live-results.json`, and `clean-checkout-browser-result.json`: independent clean-clone deployment and live checks at `b7937cf`.

## Voice results

`voice-evaluation.json`, `voice-evaluation.md`, `voice-joe.wav`, `voice-ljspeech.wav`, and `voice-sample-text.txt` contain matched real samples, model identities and hashes, generation measurements, and the selection rationale. Joe's median generation-time/audio-duration ratio was 0.1152; LJ Speech's was 0.1484. The user selected Joe after listening.

## Security results

`live-security-results.json` records direct and controlled-redirect IPv4 and IPv6 checks with **zero prohibited connections** and explicit loopback TTS denial before resolution. The API listens on `127.0.0.1:8000`, and TTS listens on `127.0.0.1:8765`. Only the FastAPI application port is exposed through the Quick Tunnel. The first `httpbin.org` redirect attempt was blocked and was not counted as a pass; a controlled Quick Tunnel fixture supplied the successful redirect source.

## Target-phone results

`device-results.md` records:

- Android 12 build identity and Chrome `138.0.7204.157`.
- A fully passing real M3 application procedure over mobile data.
- A fully passing isolated M1 probe procedure, including the 18:00–18:30 network-disabled locked-screen run on 2026-11-10.
- Final `2026-11-11-quality-r7` update and offline-preservation success.
- Lock-screen controls unavailable and headset tested with no exposed controls. These are recorded platform limitations allowed by AC9, not unperformed procedures or working-control claims.

The isolated probe result does not establish real-item offline readiness, which remains outside M3.

## Reproduction

See `deploy/README.md` for locked installation, model verification, process configuration, Quick Tunnel setup, source and browser runners, controlled redirect setup, and phone procedures. The main live runner is `server/application_live_checks.py`. No credential, password hash, session cookie, private generation endpoint, or unintended private content appears in the evidence.

## Milestone decision

`pass`. AC1–AC8 pass, and AC9 is satisfied by this evidence set. The M3 application is usable for authenticated public-article and Markdown preparation with real local TTS, durable jobs, complete audio and timings, and online read-along playback. A separate roadmap-status change may mark M3 as Done after the implementation PR is merged.
