# Offline library and playback verification

This directory records issue #13 evidence. Automated and real-Chromium results do not replace target-phone acceptance. The removed intermittent shell-launch symptom is outside this procedure.

## Evidence rules

Record the exact tested commit, public origin, Android and Chrome versions, steps, and pass/fail/blocked outcomes. Use public test content. Do not record passwords, password hashes, session cookies, authentication response bodies, private generation endpoints, item identifiers, or unintended private content.

## Automated checks

From the repository root:

```sh
npm test
npm run check:syntax
UV_PROJECT_ENVIRONMENT=/tmp/opencode/vesna-issue13-venv uv sync --project server --extra test --locked
/tmp/opencode/vesna-issue13-venv/bin/python -m pytest server/tests
```

Raw final outputs are in `automated-javascript.txt` and `automated-python.txt`.

## Controlled real-Chromium check

`deploy/browser_offline_check.cjs` requires a prepared public test item and a temporary Playwright installation. See `deploy/README.md` for its environment variables. It deletes its temporary browser profile before starting. It does not delete the server item.

The recorded run used a temporary loopback FastAPI application, a controlled Markdown item named `offline-sample`, deterministic WAV speech assembled through the real worker and FFmpeg, Chromium `141.0.7390.37`, and no external provider. The runner:

1. Signed in and explicitly downloaded the prepared item.
2. Verified exactly four prepared resources and zero unrelated private/auth/source responses in Cache Storage.
3. Closed Chromium and cold-started with the same profile and networking disabled.
4. Opened the offline library and reader without a password; checked playback, restored speed, selected-paragraph playback, previous/next controls, highlighting, and automatic scrolling.
5. Fetched the cached audio through the worker and verified full `200`, satisfiable-range `206`, and unsatisfiable-range `416` responses.
6. Changed position and speed, performed a second offline cold restart, and checked both restored.
7. Removed the device download offline and verified online that the server item remained.
8. Verified zero failed prepared-resource requests while offline.

`browser-result.json` is the sanitized raw result. Persistent storage was not granted in this headless context; the UI displayed the required retention warning and the item remained usable during the test. This is not a persistent-storage or Android acceptance result.

## Target-phone procedure

Use one fixed HTTPS origin and the installed Vesna PWA on the Huawei Pura 80 Pro. Record the current Android and Chrome versions and visible online commit before starting.

### Download and offline use

1. Online, sign in and open a prepared public test item.
2. Select **Download for offline use**. Wait for **Available offline**. Record whether persistent storage was granted or a retention warning appeared.
3. Close the PWA fully. Disable Wi-Fi and mobile data.
4. Reopen the same installed entry. Pass only if the offline library appears without a password and identifies offline mode.
5. Open the item. Verify its listening text, play/pause, direct seek, previous/next paragraph, selected-paragraph playback, speed, highlighting, and automatic scrolling.
6. Pause at a nonzero position with a non-default speed. Close and reopen offline again. Verify actual position and speed restoration.
7. Verify that content input, source inspection, retry, and server deletion are unavailable offline.

### Interruption and storage state

1. While online, start a download and disable networking before completion. Pass only if no new offline-ready state is published and an earlier complete version remains usable when present.
2. Reconnect and retry. Verify one complete current download.
3. Record persistent-storage denial or insufficient-space behavior if the device provides a controlled way to exercise it. Do not manufacture a success result.
4. Missing or removed device data must produce a clear state and must not be called offline-ready.

### Replacement and removal

1. Download the original ready version.
2. After a new prepared version exists, confirm that the old download remains usable and the interface offers an offline update.
3. Download the update and verify that the new version works after an offline restart.
4. Use **Remove offline download**. Verify that the server item remains online and the item no longer appears after an offline restart.

### Server deletion and locked screen

1. Download a disposable prepared item.
2. Online, confirm **Delete item**. Verify that its local download and playback state are removed on this phone and other downloads remain.
3. With another fully downloaded item, start playback, lock the screen, and keep networking disabled. Verify continuity for the complete public test item. Record exposed lock-screen and headset controls; unavailable controls are not presented as working.

Record every result in `device-results.md`. Any unperformed required check is **blocked**. Do not mark AC6 or the issue accepted until the required phone results pass.
