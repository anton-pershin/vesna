# Target-phone results

Check dates: **2026-11-10 and 2026-11-11**.

## Device identity

- Device: Huawei Pura 80 Pro used for the M1 and M3 phone procedures.
- Operating system: `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`
- Chrome: `138.0.7204.157`
- M3 application origin: `https://track-ruling-wifi-absence.trycloudflare.com`
- Isolated probe origin: `https://zip-shortly-str-robertson.trycloudflare.com`
- Final isolated probe build: `2026-11-11-quality-r7`

## Real M3 application

Result: **pass**.

The user performed the external-network procedure using mobile data. Installation, sign-in, article and Markdown source inspection, real audio playback, paragraph navigation, selected-paragraph playback, seeking, speed changes, highlighting, automatic-scroll control, saved position and speed, another-app playback, locked-screen playback, mobile layout, and unauthenticated denial all passed.

The user initially reported that paragraph two lost its highlight during playback while the audio position remained correct. The issue was isolated to transient invalid media positions. Commit `5789190` preserves the last valid paragraph for those values, and the user then confirmed that **Part 1 fully passed**.

Lock-screen media controls were **not exposed** by this device and Chrome combination. The procedure and observation are recorded. AC9 explicitly permits unavailable device controls; this is not a failure.

## Isolated M1 regression probe

Result: **pass**.

The isolated synthetic probe passed installation, offline-fixture preparation, offline launch, seeking, speed changes, previous/next and selected-paragraph playback, highlighting, automatic scrolling, saved-position recovery, another-app playback, and the locked-screen offline continuity procedure.

The 30-minute locked-screen, network-disabled run completed at approximately **18:00–18:30 on 2026-11-10**. Playback crossed all 12 paragraph boundaries and reached the end without an application-caused stop at a paragraph boundary.

The user also completed the service-worker update and preservation procedure. The update initially exposed stale implicit HTTP caching: the active v13 shell contained r5 resources. The server now sends `Cache-Control: no-cache`, and the clean r7/v14 shell update succeeded. After updating, the user disabled networking and confirmed that the downloaded fixture and saved playback state remained usable. The final build is `2026-11-11-quality-r7`.

These results apply only to the isolated synthetic M1 probe. They do not establish real-item offline readiness, which remains outside M3.

## Headset and lock-screen controls

- Lock-screen controls: **unavailable** on the tested device and Chrome.
- Headset: **tested; no controls were exposed**.
- Both procedures and observations are recorded. The acceptance criteria allow unavailable controls, and the user does not require these controls. No unavailable item is presented as a verified working control.

## External network

The real M3 application was installed and used successfully over mobile data. This satisfies the user-assisted external-network check. The controlled API security results are recorded separately in `live-security-results.json` and `live-source-results.json`.
