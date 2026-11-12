# Target-phone results

Status: **pending — no M4 target-phone result has been recorded yet**

## Device identity

- Intended device: Huawei Pura 80 Pro used for M1 and M3 procedures.
- Previously recorded operating system: `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`
- Previously recorded Chrome: `138.0.7204.157`
- Confirm and record the current operating-system and Chrome versions during the M4 run.
- M4 application origin: `https://record-candidates-img-hwy.trycloudflare.com`
- Isolated probe origin and build: `https://zip-shortly-str-robertson.trycloudflare.com`, `2026-11-12-m4-r8`

## Required M4 application procedure

Perform these checks on the target phone through the public HTTPS origin:

1. Install/open the PWA and sign in with the configured single-user password.
2. Add `https://example.com` as a public article. Confirm separate input and reader screens, preparation updates, and real audio playback.
3. Upload a UTF-8 Markdown test document. Confirm source selection, preparation, and playback.
4. Open a ready item and verify:
   - The bottom playback bar remains visible while scrolling and does not cover the final paragraph.
   - Play/pause, direct seeking, previous/next paragraph, selected-paragraph playback, speed, and automatic scrolling.
   - Source information opens on demand, including original Markdown for the uploaded item.
   - Reopening restores position and speed.
   - Another-app and locked-screen playback continue. Check lock-screen and headset controls where exposed; record unavailable controls explicitly.
5. Delete a disposable item:
   - Cancel first and verify the item and playback remain.
   - Confirm deletion and verify playback stops, the item disappears, and its source/audio cannot be retrieved again.
6. Inspect the library, add-content, reader, source, and deletion screens for visual acceptance, readable text, touch usability, and horizontal overflow.
7. Sign out and confirm private screens are cleared.

Record each result explicitly as pass, fail, or blocked. Do not infer a phone pass from desktop Chromium.

## Isolated M1 regression procedure

The shared playback-state module gained a per-item deletion cleanup method. The synthetic probe is bumped to `2026-11-12-m4-r8` with a new shell cache while its playback behavior remains unchanged.

1. Open the isolated probe online and allow `2026-11-12-m4-r8` to activate without clearing site data.
2. Disable networking and reopen the installed probe.
3. Confirm the existing downloaded fixture remains available, playback works, and saved position and speed restore.
4. Re-enable networking and record the result and current device/browser versions.

The prior M1 30-minute locked-screen run covered playback and timing code that is unchanged in M4. This M4 check addresses shared playback-state and update preservation; it does not establish real-item offline readiness.

## Current observations

No M4 phone observations are recorded yet. All items above remain pending.
