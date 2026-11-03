# Android playback feasibility result

Status: **in progress — AC1–AC6 pass; AC7 correction and the AC8 decision are in progress**

## Test identity

- Device-tested commit: `0a65263`
- HTTPS origin: `https://45.129.142.83/`
- Phone model: `Huawei Pura 80 Pro`
- Android version: `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL` (from `chrome://version`)
- EMUI version: `15.0.0`
- Chrome version: `138.0.7204.157`
- Test date: `2026-11-03` (latest checks reported by user)
- Network state during offline tests: Wi-Fi and mobile data disabled, as instructed

## Automated checks

- Command: `npm test`
- Result: 54 passed, 0 failed during AC4 repair verification. Raw output: `evidence/android-playback/automated-tests.txt`.
- Fixture duration: `1805.061224` seconds, measured with `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 public/fixtures/audio/fixture.mp3`
- Fixture SHA-256: `124cbb44009162acd05b8fff413910c0cd0f8e05df4400d29f6b8c3b65f1da76`. The committed MP3 is the canonical fixture binary.
- Fixture version: `fixture-en-v1`
- Paragraph count: `12`
- Deployment check on `2026-11-03`: commit `0a65263`, probe build `2026-11-03-ac1-ac4-r4`, and shell cache `vesna-probe-shell-v11` are served from the HTTPS origin. A request for bytes `1000-1999` returned `206 Partial Content`, the required headers, and the exact 1000-byte body.

## Acceptance record

| Criterion | Result (pass/fail/blocked) | Raw observation / reproduction |
|---|---|---|
| AC1 Probe structure and installation | pass | The user confirms that the repaired probe is installed and works as a separate app. Chrome reports `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`. |
| AC2 Offline launch and readiness | pass | On the repaired deployment, the user reports that the offline launch and readiness checks work as expected. |
| AC3 Foreground playback and read-along | pass | On the repaired deployment, the user reports that the foreground playback and read-along checks work as expected. |
| AC4 State restoration | pass | On the repaired deployment, the user reports that the specified 530-second, 2×, offline close-and-reopen procedure works as expected. This supersedes the earlier failure recorded below. |
| AC5 Locked-screen playback | pass | The user reports that the complete locked-screen procedure works as expected with the network disabled. Chrome and the device exposed no lock-screen media controls; this is recorded as unavailable, not as an implementation failure. |
| AC6 Other-application playback | pass | Playback continued with another application in the foreground. Headset play/pause worked. Return to Vesna showed the correct position and highlight. No interruptions occurred. |
| AC7 Version and resource integrity | fail in code review; correction in progress | Code review found that worker cache selection, cached replacement downloads, and content validation did not prove version integrity. The repair uses explicit publication, network downloads, and staged metadata/audio validation. Worker integration verification is in progress. |
| AC8 Evidence and decision | blocked | AC1–AC6 device observations and the original automated output are recorded. The final decision waits for the AC7 correction and its automated verification. |

## Raw observations

- Operating system: Device settings expose EMUI `15.0.0`. The operating-system line in `chrome://version` is `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`. Chrome is `138.0.7204.157`.
- Installation: The user confirms that the repaired probe is installed and works as a separate app on `2026-11-03`.
- Offline launch and foreground playback: On `2026-11-03`, the user reported that the quick offline checks work as expected on the repaired deployment.
- State restoration on `2026-11-03`: The user reported that AC4 works as expected on the repaired deployment. The test used a 530-second position and 2× speed during an offline close and reopen.
- Earlier state-restoration failure: On the older deployment, the status reported a restored 530-second position at 2×, but both position controls showed zero. The repair added a new shell cache, byte-range responses, actual-position verification, failure diagnostics, and saved-state protection.
- Locked-screen playback on `2026-11-03`: The user reported that AC5 works as expected. The procedure used the complete 30:05 fixture at 1× with the screen locked and the network disabled. Chrome and the device exposed no lock-screen media controls.
- Other-application playback on `2026-11-03`: The user reported that AC6 works as expected. The procedure crossed a paragraph boundary while another application was in the foreground. Headset play/pause worked. Returning to Vesna showed the correct position and highlight. No interruptions occurred.
- Fixture limitation: The audio is synthetic and does not contain spoken paragraphs. These results verify playback and timing behavior, not speech quality or speech/text alignment.

## Overall decision

`blocked` by the AC7 code-review finding. AC1–AC6 pass on the Huawei Pura 80 Pro. AC8 remains blocked until the AC7 correction passes worker integration tests and this record is updated. The device results do not verify speech quality, speech/text alignment, comourat integration, or TTS integration.
