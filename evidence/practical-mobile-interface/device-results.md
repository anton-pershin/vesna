# Target-phone results

Status: **pass**

Check date: **2026-11-13**.

## Device identity

- Device: Huawei Pura 80 Pro used for M1 and M3 procedures.
- Operating system: `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`
- Chrome: `138.0.7204.157`
- The user confirmed that the operating-system and Chrome versions are unchanged from the previous recorded run.
- M4 application origin: `https://record-candidates-img-hwy.trycloudflare.com`
- Final visible build identity: `68344897`
- Isolated probe origin: `https://zip-shortly-str-robertson.trycloudflare.com`
- Final isolated probe build: `2026-11-13-m4-r10`

## Real M4 application

Result: **pass**.

The user completed the article and Markdown input-to-listening workflows through the public HTTPS application. Separate library, content-input, and reader screens worked, including preparation updates and real audio playback.

The reader passed bottom-bar visibility during scrolling, final-paragraph access, play/pause, direct seeking, previous/next and selected-paragraph playback, speed and automatic-scroll settings, on-demand source inspection, original Markdown access, saved position and speed, another-app playback, and locked-screen playback. Deletion cancellation preserved the disposable item and playback; confirmed deletion stopped playback, removed the item, cleared its saved playback state, and prevented its source and audio from being retrieved again. Sign-out cleared private screens. The user accepted the visual result and interaction behavior.

### Highlight regression and correction

The user initially found that the highlight disappeared after playing item A, playing item B, and returning to item A with a saved position. Audio continued at `0:04/0:09`, and paragraph controls did not restore the highlight. The cause was stale playback controllers remaining subscribed to the shared audio element after item changes.

The implementation now destroys playback and seekbar controllers during teardown. Deterministic lifecycle tests and live Chromium cover the exact A → B → restored A path. The user confirmed that the final build displays `68344897` and that the same procedure now passes.

### Shell-update diagnosis and correction

Initial update attempts exposed stale and mixed shell resources. A diagnostic showed a `v8` cache with new `app.js` but an old API module. The final design adds:

- A public build endpoint and visible short commit ID.
- `Cache-Control: no-cache` for static shell resources.
- `cache: reload` for every resource during service-worker installation.
- Network-first shell and navigation responses with cached offline fallback.

The user confirmed the visible build identity, and the highlight test passed afterward. No unavailable platform control is presented as working; prior lock-screen and headset limitations remain recorded observations, not failures.

## Isolated M1 regression probe

Result: **pass**.

The user confirmed probe build `2026-11-13-m4-r10`, updated without clearing site data, disabled networking, and verified that the downloaded fixture, audio controls, seeking, highlighting, and saved position/speed remained usable.

The final **30-minute locked-screen, network-disabled run** completed at approximately **17:50–18:20 on 2026-11-13**. Playback crossed all 12 paragraph boundaries and reached the end without an application-caused stop.

This probe verifies the shared playback lifecycle and update-preservation behavior. It does not establish real-item offline readiness, which remains outside M4.
