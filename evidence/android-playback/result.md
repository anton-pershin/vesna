# Android playback feasibility result

Status: **in progress — AC2 passed on target device; other device checks remain blocked**

## Test identity

- Tested commit: `3ce4a54`
- HTTPS origin: `https://45.129.142.83/`
- Phone model: `Huawei Pura 80 Pro`
- Android version: not recorded
- Chrome version: not recorded
- Test date: `2026-11-02` (reported by user)
- Network state during offline tests: Wi-Fi and mobile data disabled, as instructed

## Automated checks

- Command: `npm test`
- Result: 20 passed, 0 failed (verified on commit `c64a4b9`)
- Fixture duration: `1805.000` seconds (generated synthetic local MP3)
- Fixture version: `fixture-en-v1`
- Paragraph count: `12`

## Acceptance record

| Criterion | Result (pass/fail/blocked) | Raw observation / reproduction |
|---|---|---|
| AC1 Probe structure and installation | blocked | User added a home-screen icon using Chrome's “Add to home screen” option. Chrome did not offer “Install app”. Confirm standalone PWA installation behavior on the target phone. |
| AC2 Offline launch and readiness | pass | User saw “Offline readiness: complete”, disabled Wi-Fi and mobile data, closed Vesna, reopened it from the home-screen icon, and confirmed the reader and audio were available. |
| AC3 Foreground playback and read-along | pass | User confirmed paragraph selection, Previous/Next, Position slider, and Auto-scroll work on the updated deployment. Auto-scroll follows the active paragraph as described. |
| AC4 State restoration | blocked | Test non-zero position and non-default speed after reopen. |
| AC5 Locked-screen playback | blocked | Observe at least 30 minutes across 12 paragraph boundaries. |
| AC6 Other-application playback | blocked | Test with another application foregrounded. |
| AC7 Version and resource integrity | pass | Automated fixture metadata uses `fixture-en-v1` across text, timings, and audio manifest; incomplete replacement is rejected by storage tests. |

## Raw observations

- Installation: Chrome offered “Add to home screen” but no “Install app”. The icon launches Vesna. Whether Chrome installed it as a standalone PWA is not confirmed.
- Offline launch: The user reported “Offline readiness: complete”. With Wi-Fi and mobile data disabled, closing and reopening Vesna showed the reader and audio.
- Foreground playback: Play, pause, speed control, paragraph selection, Previous paragraph, Next paragraph, and Position slider reported working on the updated deployment.
- Highlighting and timing boundaries: Active paragraph highlighting and Auto-scroll reported working on the updated deployment.
- Seeking and paragraph controls: Reported working on the updated deployment.
- State restoration: Not yet reported.
- Lock-screen controls: Not yet tested.
- Locked-screen continuity: Not yet tested.
- Other-application playback: Not yet tested.
- Interruptions and recovery: Not yet tested.

## Overall decision

`blocked` until the remaining target-phone checks pass. AC2, AC3, and automated AC7 have passed. A `pass` requires AC1–AC7 to pass on the Huawei Pura 80 Pro.
