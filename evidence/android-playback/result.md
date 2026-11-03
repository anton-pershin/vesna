# Android playback feasibility result

Status: **in progress — AC2–AC6 pass on the target device; automated AC7 passes; AC1 remains blocked**

## Test identity

- Tested commit: `0a65263`
- HTTPS origin: `https://45.129.142.83/`
- Phone model: `Huawei Pura 80 Pro`
- Android version: not available from the device settings
- EMUI version: `15.0.0`
- Chrome version: `138.0.7204.157`
- Test date: `2026-11-03` (latest checks reported by user)
- Network state during offline tests: Wi-Fi and mobile data disabled, as instructed

## Automated checks

- Command: `npm test`
- Result: 54 passed, 0 failed during AC4 repair verification. Raw output: `evidence/android-playback/automated-tests.txt`.
- Fixture duration: `1805.000` seconds (generated synthetic local MP3)
- Fixture version: `fixture-en-v1`
- Paragraph count: `12`
- Deployment check on `2026-11-03`: commit `0a65263`, probe build `2026-11-03-ac1-ac4-r4`, and shell cache `vesna-probe-shell-v11` are served from the HTTPS origin. A request for bytes `1000-1999` returned `206 Partial Content`, the required headers, and the exact 1000-byte body.

## Acceptance record

| Criterion | Result (pass/fail/blocked) | Raw observation / reproduction |
|---|---|---|
| AC1 Probe structure and installation | blocked | Earlier, Chrome offered “Add to home screen” but not “Install app”. The tested deployment includes the PNG icon repair. The latest response did not state the installation action or whether the reader opens as a standalone app. The Android version is also unavailable; the user can record only EMUI `15.0.0`. |
| AC2 Offline launch and readiness | pass | On the repaired deployment, the user reports that the offline launch and readiness checks work as expected. |
| AC3 Foreground playback and read-along | pass | On the repaired deployment, the user reports that the foreground playback and read-along checks work as expected. |
| AC4 State restoration | pass | On the repaired deployment, the user reports that the specified 530-second, 2×, offline close-and-reopen procedure works as expected. This supersedes the earlier failure recorded below. |
| AC5 Locked-screen playback | pass | The user reports that the complete locked-screen procedure works as expected with the network disabled. |
| AC6 Other-application playback | pass | The user reports that playback with another application in the foreground works as expected. |
| AC7 Version and resource integrity | pass | Automated fixture metadata uses `fixture-en-v1` across text, timings, and audio manifest; incomplete replacement is rejected by storage tests. |

## Raw observations

- Operating system: The user can record EMUI `15.0.0`, but not an Android version, from the device settings. Chrome is `138.0.7204.157`.
- Installation: Earlier, Chrome offered “Add to home screen” but no “Install app”. The icon launched Vesna. The latest response did not describe the installation result on the repaired deployment.
- Offline launch and foreground playback: On `2026-11-03`, the user reported that the quick offline checks work as expected on the repaired deployment.
- State restoration on `2026-11-03`: The user reported that AC4 works as expected on the repaired deployment. The test used a 530-second position and 2× speed during an offline close and reopen.
- Earlier state-restoration failure: On the older deployment, the status reported a restored 530-second position at 2×, but both position controls showed zero. The repair added a new shell cache, byte-range responses, actual-position verification, failure diagnostics, and saved-state protection.
- Locked-screen playback on `2026-11-03`: The user reported that AC5 works as expected. The procedure used the complete 30:05 fixture at 1× with the screen locked and the network disabled.
- Other-application playback on `2026-11-03`: The user reported that AC6 works as expected. The procedure crossed a paragraph boundary while another application was in the foreground.
- Fixture limitation: The audio is synthetic and does not contain spoken paragraphs. These results verify playback and timing behavior, not speech quality or speech/text alignment.

## Overall decision

`blocked` by AC1. AC2–AC6 pass on the Huawei Pura 80 Pro, and automated AC7 passes. A `pass` requires AC1–AC7 to pass on the target phone and the required test identity fields to be recorded.
