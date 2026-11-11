# M3 verification evidence

This directory records the complete acceptance evidence for the first usable listening application. M3 passes all AC1–AC9 criteria. Historical procedures also explain failures that were corrected before the final pass; never treat a pending or blocked result as a pass.

## Evidence rules

Record the tested Vesna commit, dependency versions, non-secret application and TTS configuration, public article URL, public temporary application origin, reproduction commands, and explicit outcomes. Keep provider credentials, password hashes, session cookies, authentication responses, private TTS addresses, and unintended private content out of all files.

Store voice samples with public test paragraphs, their SHA-256 hashes, generation measurements, and the selection rationale. Store raw automated and live command output where it is useful, but sanitize it before publication.

## Acceptance record

The current decision and raw observations are in `result.md`.

## Automated checks

Run the deterministic checks from the repository root:

```sh
npm test
python -m pytest server/tests
```

The exact virtual environment and dependency-install procedure is in `deploy/README.md`. Raw results are in `automated-python.txt` and `automated-javascript.txt`. Live source, real-TTS, Quick Tunnel, and device checks are separate procedures and must not become CI dependencies.

## Live application checks

The final record includes:

1. The single-machine application, worker, storage, and loopback TTS configuration.
2. The pinned `cloudflared` version and Quick Tunnel command.
3. Public article and UTF-8 Markdown preparation through real TTS.
4. Continued preparation after the phone disconnects.
5. Authenticated text, timing, audio, and byte-range retrieval from an external network.
6. Verification that TTS is loopback-only and absent from the Quick Tunnel.
7. Checks that private API responses and authentication responses are absent from service-worker caches.

## Target-phone checks

Final observations are in `device-results.md`. Record the phone operating-system and Chrome versions with each run.

### Real M3 item

- Install the PWA from the temporary HTTPS origin.
- Sign in and prepare one public article and one Markdown item.
- Verify source inspection and listening text.
- Verify play/pause, speed, previous/next paragraph, selected-paragraph playback, seeking, highlighting, and automatic-scroll control.
- Verify saved position and speed after reopening.
- Verify locked-screen playback, playback with another app in the foreground, and exposed lock-screen and headset controls.
- Verify that the current-paragraph indication updates within one second and does not depend only on color.
- Inspect viewport fit, labels, focus, and contrast.

A control that Chrome or the device does not expose may be recorded as unavailable. The procedure and observation are still required.

### Isolated M1 regression probe

Use the synthetic probe from the same Vesna commit on a separate origin. Do not use the production application origin or its private caches.

- Install the probe and prepare its offline fixture.
- Run the documented 30-minute locked-screen offline playback check with the network disabled.
- Verify offline launch, seeking, speed, highlighting, saved position, service-worker update, and termination recovery.
- Record that these results apply only to the synthetic M1 probe, not to real-item offline readiness.
