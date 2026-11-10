# First usable listening application result

Status: **in progress — implementation and verification are not complete**

## Test identity

- Vesna spec commit: `5d892dc`
- Vesna implementation commit: pending
- Comourat commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Python: `3.12.3`
- Cloudflared: `2026.10.7`
- FFmpeg: `6.1.1-3ubuntu5`
- TTS engine, model, and voice: pending evaluation
- Phone operating-system and Chrome versions: pending

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Authentication and input validation | pending | Implementation is in progress. |
| AC2 Article and Markdown content and library transparency | pending | Live checks have not run. |
| AC3 Durable preparation and basic retries | pending | Implementation is in progress. |
| AC4 Voice evaluation and real local TTS | pending | Candidate samples and measurements have not run. |
| AC5 Audio assembly and ready publication | pending | Implementation is in progress. |
| AC6 Playback, read-along behavior, and mobile accessibility | pending | Real-item and isolated-probe device checks have not run. |
| AC7 Secure remote access and deployment isolation | pending | The external Quick Tunnel check has not run. |
| AC8 Reproducible deployment and deterministic CI | pending | Initial local baselines pass; integrated checks have not run. |
| AC9 Evidence and milestone decision | in progress | This record and the reproduction procedure are being developed. |

## Initial local baselines

- M1 JavaScript baseline before M3 changes: 70 passed, 0 failed.
- M2 Python baseline before M3 changes: 36 passed, 0 failed.
- Development machine: Ubuntu 24.04, x86_64, Intel Core i7-8550U, 8 logical CPUs, 15 GiB RAM.
- No baseline used external services or credentials.

## Milestone decision

`in progress`. M3 remains incomplete until every AC1–AC8 check passes and the required sanitized evidence is recorded.
