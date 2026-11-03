# Android playback feasibility result

Status: **in progress — AC2 and AC3 pass; AC4 failed on latest device check; AC1, AC5, and AC6 remain blocked**

## Test identity

- Tested commit: `c8f6117`
- Repair state awaiting deployment and device retest: local branch tip after `c8f6117`; see git history for the exact commits
- HTTPS origin: `https://45.129.142.83/`
- Phone model: `Huawei Pura 80 Pro`
- Android version: not recorded
- Chrome version: not recorded
- Test date: `2026-11-02` (reported by user)
- Network state during offline tests: Wi-Fi and mobile data disabled, as instructed

## Automated checks

- Command: `npm test`
- Result: 54 passed, 0 failed during AC4 repair verification. Raw output: `evidence/android-playback/automated-tests.txt`.
- Fixture duration: `1805.000` seconds (generated synthetic local MP3)
- Fixture version: `fixture-en-v1`
- Paragraph count: `12`

## Acceptance record

| Criterion | Result (pass/fail/blocked) | Raw observation / reproduction |
|---|---|---|
| AC1 Probe structure and installation | blocked; install metadata repair awaiting retest | User added a home-screen icon using Chrome's “Add to home screen” option. Chrome did not offer “Install app”. The manifest now has 192 px and 512 px PNG icons and a separate maskable PNG icon. Confirm standalone PWA installation behavior on the target phone. |
| AC2 Offline launch and readiness | pass | User saw “Offline readiness: complete”, disabled Wi-Fi and mobile data, closed Vesna, reopened it from the home-screen icon, and confirmed the reader and audio were available. |
| AC3 Foreground playback and read-along | pass | On the current deployment, the user reports the Position slider works again. Prior target-device checks also confirmed paragraph selection, Previous/Next, and Auto-scroll. |
| AC4 State restoration | fail on latest device check; repair awaiting retest | On offline refresh, status says "Restored position 530 seconds at 2×", but both the audio play bar and the Position slider show 0. Non-default speed restores. The repair adds shell cache v11, cached and online byte-range support, actual-position verification, failure diagnostics, and saved-state protection. No phone result is available for the repair. Do not claim AC4 passes. |
| AC5 Locked-screen playback | blocked | Observe at least 30 minutes across 12 paragraph boundaries. |
| AC6 Other-application playback | blocked | Test with another application foregrounded. |
| AC7 Version and resource integrity | pass | Automated fixture metadata uses `fixture-en-v1` across text, timings, and audio manifest; incomplete replacement is rejected by storage tests. |

## Raw observations

- Installation: Chrome offered “Add to home screen” but no “Install app”. The icon launches Vesna. Whether Chrome installed it as a standalone PWA is not confirmed. The PNG and maskable icon repair has no device result yet.
- Offline launch: The user reported “Offline readiness: complete”. With Wi-Fi and mobile data disabled, closing and reopening Vesna showed the reader and audio.
- Foreground playback: Play, pause, speed control, paragraph selection, Previous paragraph, Next paragraph, and Position slider work on the current deployment, according to user reports.
- Highlighting and timing boundaries: Active paragraph highlighting and Auto-scroll reported working on the current deployment. Fixture audio is synthetic and does not contain spoken paragraphs.
- Seeking and paragraph controls: Reported working on current deployment.
- State restoration: Non-default speed restores. Status reports "Restored position 530 seconds at 2×", but audio and Position bars remain at 0 after offline refresh.
- Development audit after that observation: shell cache v7 did not change when later player fixes were deployed, so an existing client could keep the old modules. A production request for `Range: bytes=1000-1999` returned `200 OK` and the complete MP3. These findings require a new deployment and phone retest; they do not change the recorded AC4 failure into a pass.
- Lock-screen controls: Not yet tested.
- Locked-screen continuity: Not yet tested.
- Other-application playback: Not yet tested.
- Interruptions and recovery: Not yet tested.

## Overall decision

`blocked` until the remaining target-phone checks pass. AC2, AC3, and automated AC7 have passed. A `pass` requires AC1–AC7 to pass on the Huawei Pura 80 Pro.
