# First usable listening application result

Status: **in progress — live application checks pass; external-device and final CI checks remain**

## Test identity

- Vesna spec commit: `5d892dc`
- Vesna implementation commit: `b7937cf` (clean-checkout verification); final evidence commit pending
- Comourat commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Python: `3.12.3`
- Cloudflared: `2026.10.7`
- FFmpeg: `6.1.1-3ubuntu5`
- TTS: `piper-tts==1.8.0`, `onnxruntime==1.31.1`
- Selected voice: `en_US-joe-medium`, revision `cf910fb59f1d79ab3b625a63993a108751c6c25d`
- Voice identity: `piper-en-us-joe-medium-cf910fb5`
- Live Chromium: `141.0.7390.37`
- Temporary application origin: `https://track-ruling-wifi-absence.trycloudflare.com`
- Temporary isolated-probe origin: `https://zip-shortly-str-robertson.trycloudflare.com`
- Phone operating-system and Chrome versions: pending user-assisted checks

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Authentication and input validation | pass | The locked deterministic suite covers authentication, cookies, Origin/Host behavior, upload limits, UTF-8, prohibited inputs, XSS, and request limits. Live sign-in, bad-password denial, sign-out, and cross-origin mutation denial also pass. |
| AC2 Article and Markdown content and library transparency | pass | `live-source-results.json` records passing Example Domain and three-paragraph Markdown preparation. Expected article text is present, and original Markdown matches the uploaded bytes. |
| AC3 Durable preparation and basic retries | pass | Deterministic restart, claim, lease, concurrency, stage-reuse, and retry tests pass. The live submitting client disconnected before both jobs completed; fresh authenticated sessions retrieved the ready results. |
| AC4 Voice evaluation and real local TTS | pass | Joe and LJ Speech each completed three matched real-generation runs. `voice-evaluation.json` and `voice-evaluation.md` record samples, hashes, speed, memory, and selection rationale. The user selected Joe, and both live items used real loopback Piper TTS. |
| AC5 Audio assembly and ready publication | pass | Deterministic FFmpeg consistency and corruption tests pass. Both live source items produced version-matched text, timings, and MP3 audio and played in real Chromium. |
| AC6 Playback, read-along behavior, and mobile accessibility | pending user-assisted device checks | Headless Chromium playback, navigation, selected paragraphs, speed, restore, accessibility, and mobile-overflow checks pass. Real-phone controls and the isolated 30-minute offline probe remain. |
| AC7 Secure remote access and deployment isolation | pending external-network device check | Public Quick Tunnel API checks, loopback listeners, unauthenticated denial, cache exclusion, and direct/redirect zero-connection security checks pass. A user-assisted external-network phone check remains. |
| AC8 Reproducible deployment and deterministic CI | pending hosted CI | Clean checkout `b7937cf` reproduces locked dependencies, verified model, 161 Python tests, 119 JavaScript tests, real three-process deployment, both live sources, and Chromium playback. Systemd units pass isolated syntax/executable validation. Hosted CI remains. |
| AC9 Evidence and milestone decision | in progress | Sanitized voice, source, security, browser, and reproduction records exist. Device evidence, final implementation identity, and hosted CI remain. |

## Automated results

- Locked Python application and integration tests: **161 passed, 0 failed**.
- JavaScript application and isolated-probe tests: **119 passed, 0 failed**.
- JavaScript syntax checks: pass.
- Locked application/TTS dependency installation and imports: pass.
- No deterministic check used external services, credentials, or target-phone access.

## Live source and browser results

- `live-source-results.json`: article and Markdown pass through the temporary public HTTPS application. Both include real audio hashes and authenticated `206`/`416` range checks. Markdown confirms continued preparation after disconnect and server-side sign-out.
- `browser-result.json`: real Chromium decodes and plays both live items, navigates paragraphs, changes speed, restores position and speed, reports no horizontal overflow, and records zero private responses in Cache Storage.
- `browser-m3.png`: sanitized real-item browser capture. It contains only public test content and no credentials or private TTS address.
- `voice-evaluation.json`, `voice-evaluation.md`, `voice-joe.wav`, `voice-ljspeech.wav`, and `voice-sample-text.txt`: matched real voice evaluation and selection evidence.

## Live security results

`live-security-results.json` records:

- Direct IPv4: pass, zero connections.
- Redirect IPv4 through a controlled public Quick Tunnel fixture: pass, zero connections.
- Direct IPv6: pass, zero connections.
- Redirect IPv6 through the same controlled fixture: pass, zero connections.
- Explicit loopback TTS denial by the source-fetch policy: pass before resolution.

The API listens on `127.0.0.1:8000`, and TTS listens on `127.0.0.1:8765`. The public application tunnel returns `404` for `/synthesize`; only the FastAPI application port is exposed. The first `httpbin.org` redirect attempt was blocked because the service did not return controlled targets. It was not counted as a pass; the controlled Quick Tunnel fixture replaced it.

## Clean-checkout reproduction

`clean-checkout-result.json`, `clean-checkout-live-results.json`, and `clean-checkout-browser-result.json` record a separate clean-clone deployment at `b7937cf`. The clone installed locked application and TTS dependencies, downloaded and verified the pinned Joe model, passed both deterministic suites, and passed the complete public source and browser checks through its own Quick Tunnel. Systemd units passed syntax and executable validation in an isolated root with stub entry points and target units. The operator host did not provide passwordless sudo, so the live reproduction used the same three console entry points in the foreground.

## Reproduction

See `deploy/README.md` for the locked installation, model download and verification, process configuration, Quick Tunnel setup, source runner, browser runner, controlled redirect fixture, and phone procedures. The main live runner is `server/application_live_checks.py`. No credential or private generation endpoint appears in the evidence.

## Milestone decision

`in progress`. M3 remains incomplete until the external-network phone checks, required real-device playback and isolated-probe regressions, and hosted CI pass. A blocked or unperformed check does not count as a pass.
