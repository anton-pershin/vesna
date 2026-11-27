# Offline library and playback result

Status: **automated and controlled Chromium checks pass; target-phone acceptance is blocked**.

## Test identity

- Issue: #13, approved after the investigation recorded in `.internal/investigations/offline-library-and-playback.md`.
- Baseline: `5f14f73abd4027ff8f34e43558f76662a68852e0`.
- Spec: `.internal/specs/13-offline-library-and-playback-general-spec.md`.
- Node: `26.8.1`.
- Python: `3.12.13`.
- Chromium: `141.0.7390.37`.
- Controlled live fixture: loopback FastAPI, durable worker, deterministic WAV speech, real FFmpeg assembly, and a prepared public Markdown item.
- Target phone: final implementation not yet deployed; see `device-results.md`.

Credentials, cookies, private item identifiers, source content, and the temporary runtime database are not recorded.

## Acceptance record

| Criterion | Result | Evidence |
|---|---|---|
| AC1 Manifest and explicit download | pass in automated/Chromium scope | Server tests cover authentication, ready/unready versions, and tampering. Browser runner explicitly downloads one item and verifies four prepared resources. Persistent-storage denial shows a warning rather than permanent retention. |
| AC2 Atomic failure and storage handling | pass in automated scope | Tests cover interruption, integrity mismatch, index/item-cache write failures, insufficient estimated space, lost resources, concurrent replacement, removal, reconciliation, and old-cache cleanup failure. Previous publications survive failed replacements. |
| AC3 Offline library and playback | pass in Chromium; phone blocked | Two full offline cold restarts open the library and reader without a password. Playback, speed/position restoration, and cached resources pass. No prepared request fails offline. Phone evidence is not available. |
| AC4 Reconciliation, updates, and removal | pass in automated/Chromium scope | Tests cover update availability, replacement, orphan reconciliation, deletion cleanup, and update preservation. Browser removal preserves the server item. |
| AC5 Security and regression | pass | 180 JavaScript tests and 192 Python tests pass. Browser cache inspection finds zero auth, unrelated library, or source responses. Existing probe, authentication, playback, and deletion tests remain green. |
| AC6 Live browser, target phone, and evidence | **blocked** | The controlled real-Chromium run passes. Required target-phone checks are not performed and are not claimed as passed. |

## Automated results

- `automated-javascript.txt`: **180 passed, 0 failed**, plus syntax checks for browser, test, probe, and deployment JavaScript.
- `automated-python.txt`: **192 passed, 0 failed**.
- `browser-result.json`: **pass** for the controlled real-item workflow in Chromium 141.
- `ci-results.json`: hosted CI **pass**, run `46047698482`, at head `7a7aaf19ce965d2bb2f6931eddedab4509d99a1d`.

## Material correction found by live evidence

The first real download failed its text integrity check because the API reserialized JSON artifacts while manifest hashes identified their raw stored bytes. The text and timings endpoints now return the validated raw artifact bytes. A server regression test compares each HTTP response body with the stored file, and the complete browser workflow then passed.

## Decision

The implementation is suitable for code review and maintainer-assisted phone testing. AC6 and overall issue acceptance remain **blocked** until the phone procedure passes. The separate intermittent shell-launch symptom is excluded from issue #13 and does not affect this record.
