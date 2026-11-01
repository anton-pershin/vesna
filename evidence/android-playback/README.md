# Huawei Pura 80 Pro M1 procedure

This procedure is for the installed PWA served from an HTTPS origin. Desktop checks do not replace the phone checks. Record raw observations, timestamps, interruptions, and exact browser/device versions in `result.md`.

## Before testing

- Record the tested commit and deployed HTTPS origin.
- On the Huawei Pura 80 Pro, record Android version and Chrome version.
- Use the production HTTPS deployment, not the local HTTP development server.
- Keep the fixture page open until its audio resource has fully downloaded and **Offline readiness: complete** is shown.
- Do not use credentials, external content, or network-dependent fixture resources.

## Installation and download

1. Open the HTTPS origin in Chrome.
2. Confirm the page identifies itself as the Vesna Android playback probe.
3. Use Chrome's **Install app** / **Add to home screen** flow and launch the installed entry.
4. Press **Prepare offline fixture** and wait for the complete readiness message.
5. Confirm the title, 12 paragraphs, controls, audio duration (at least 30 minutes), and reader are visible.

## Offline launch

1. Close the PWA.
2. Disable Wi-Fi and mobile data. Do not enable either during the offline checks.
3. Launch the installed PWA from the home screen.
4. Mark pass only if the fixture title, paragraphs, controls, and audio are available without a network request.
5. If storage is cleared or a resource is missing, record the exact error and mark the criterion fail or blocked; do not infer readiness.

## Foreground playback and read-along

With the network still disabled:

1. Start playback and verify play and pause.
2. Test seeking with the audio controls.
3. Select speeds 0.75x, 1x, 1.25x, 1.5x, and 2x.
4. Test previous paragraph, next paragraph, and selecting a paragraph to play from that point.
5. Verify the active paragraph has a non-color visual indication and changes within one second of tested timing boundaries.
6. Verify automatic scrolling follows the active paragraph.
7. Disable **Auto-scroll** and verify highlighting continues while the reader stays in place.

## Resume and Media Session

1. Stop at a non-zero position and select a non-default speed.
2. Close and reopen the installed PWA while offline.
3. Verify the selected fixture version, position, and speed are restored.
4. With playback running, lock the screen. Record the controls exposed by Chrome and the device.
5. Test lock-screen play/pause and seek controls when available.
6. Test headset play/pause if a headset is available. Record unavailable controls as unavailable, not as an implementation failure.

## Locked-screen continuity (AC5)

1. Start the fully downloaded fixture from the beginning or a recorded position.
2. Lock the screen with Wi-Fi and mobile data disabled.
3. Observe playback for at least 30 minutes and across all 12 paragraph boundaries.
4. Record whether playback reaches the end and whether any stop was caused by the app at a paragraph boundary.
5. Record phone interruptions separately: calls, explicit user actions, browser termination, operating-system policy, or battery management.

## Other-application playback (AC6)

1. Start the fully downloaded fixture.
2. Open another application and leave Vesna in the background.
3. Verify playback continues across paragraph boundaries.
4. Test lock-screen pause/resume and headset controls if available.
5. Return to Vesna and record the current position and highlight.

## Result rules

- Mark each AC1–AC7 criterion **pass**, **fail**, or **blocked** with raw observations.
- A device check not performed is **blocked**, not pass.
- The overall result is **pass** only when AC1–AC7 pass on the Huawei Pura 80 Pro.
- A browser or platform limitation is recorded explicitly and prevents an overall pass.
