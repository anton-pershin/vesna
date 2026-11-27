## Offline library and playback

**Status**: active

### Objective

Implement issue #13 so that an explicit, complete per-item download remains available in the installed PWA after a network-disabled close and reopen. Link the governing requirements: constitution FR9–FR11, NFR1–NFR4, AC4–AC6, and section 5.1.

The revised issue excludes the separate intermittent failure to load the public shell. That symptom needs a new issue and fresh evidence if it occurs again.

### Current constraints

- Use explicit per-item downloads. Automatic downloading is outside the approved scope.
- Only a complete, verified prepared version may be marked as an offline-ready download.
- Offline use must not require a server request, password verification, or a refreshed authentication session.
- Passwords, session tokens, authentication responses, and generation endpoints must not enter offline caches.
- Preserve an earlier complete download until its replacement is complete.
- Browser clearing, uninstallation, and operating-system storage removal cannot be prevented. Detect missing data where possible and provide a recovery action.
- Keep the implementation in `anton-pershin/vesna`; no comourat change is required.
- Work on the approved issue branch. Target-phone evidence requires the maintainer's device.

### Current state

At revision `5f14f73abd4027ff8f34e43558f76662a68852e0`, the production service worker caches 20 public shell resources and bypasses all API routes. Startup requires `/api/auth/session`; the library and prepared artifacts require authenticated network requests. The only per-item browser state is playback position and speed. The M1 synthetic probe proves staged fixture publication, cached audio ranges, offline playback, resume, and update preservation on the target phone, but it does not implement real-item downloads.

### Contexts

| ID | Solution implementation | Validation setup | Runtime and environment | Baseline |
|----|-------------------------|------------------|-------------------------|----------|
| C1 | `5f14f73abd4027ff8f34e43558f76662a68852e0` | Public shell only; no credentials or private content | Deployed Quick Tunnel origin; desktop Chromium 141.0.7390.37 | 147 JavaScript tests and syntax checks pass; no real-item offline implementation |
| C2 | Same revision | Maintainer-controlled phone check | Huawei Pura 80 Pro; origin and short commit confirmed by the maintainer | Online build `5f14f73a`; immediate offline launch shows the password screen, `Failed to fetch`, and `M4` |
| C3 | Issue #13 implementation branch | 199 JavaScript tests, syntax checks, 192 Python tests, and real Chromium offline restarts | Python 3.12.13; Node 26.8.1; Chromium 141.0.7390.37; controlled loopback FastAPI, worker, WAV speech, and FFmpeg | Automated suites and real-item offline workflow pass; final target-phone acceptance is blocked |

### Current understanding

#### Supported by evidence

- The current password screen and `Failed to fetch` are consequences of the network-only startup path, not a password failure.
- `M4` is the hard-coded build-label fallback when the public build request fails. It does not identify a stale installation.
- The deployed public shell files matched the investigated revision during C1.
- Desktop Chromium opened the cached shell after a complete browser restart and an offline reload.
- The maintainer confirmed the current origin, explicit per-item download behavior, and the same immediate offline result on the phone.
- The existing server has prepared-version manifests and artifact hashes, but the browser API has no manifest operation.

#### Tentative or unresolved

- The removed intermittent shell-launch symptom has no confirmed cause and is outside this investigation.
- Persistent-storage behavior, quota limits, and actual offline media behavior for real items still require verification on the maintainer's phone.

### Experiments and decisions

| ID | Idea or question | Context | Result and evidence links | Decision and rationale |
|----|------------------|---------|---------------------------|------------------------|
| E1 | Identify the current offline behavior | C1 | Public files matched revision `5f14f73`; 147 JavaScript tests passed. The service worker bypassed API and artifact requests. Issue comment: https://github.com/anton-pershin/vesna/issues/13#issuecomment-7216533151 | Treat offline library and playback as missing M6 functionality, not a small authentication repair. |
| E2 | Test cold offline shell launch | C1 | With 20 cached shell resources and an active worker, two offline launches opened the shell. Only `/api/build` and `/api/auth/session` failed. Same issue comment as E1. | Reuse the shell navigation fallback and focus the change on downloads and offline application state. |
| E3 | Clarify origin, download behavior, and phone behavior | C2 | The maintainer selected explicit per-item downloads, confirmed the current origin and commit, and reproduced the password screen offline. Issue comment: https://github.com/anton-pershin/vesna/issues/13#issuecomment-7219200363 | Do not automatically download every prepared item. Only complete downloads receive an offline guarantee. |
| E4 | Test whether deleting only the named shell cache explains the removed symptom | C1 | The negative desktop result did not reproduce the launch failure. Issue comment: https://github.com/anton-pershin/vesna/issues/13#issuecomment-7219291326 | Do not infer cache eviction. The maintainer later removed this symptom from issue #13. |
| E5 | Final issue scope | C2 | The maintainer removed the shell-launch symptom and deferred it to a future issue. Issue comments: https://github.com/anton-pershin/vesna/issues/13#issuecomment-7224055336 and https://github.com/anton-pershin/vesna/issues/13#issuecomment-7224070418 | Exclude the multi-day shell investigation. Retain storage-loss handling because the constitution requires it. |
| E6 | Verify real manifest hashes against downloaded JSON | C3 | The first browser download failed because FastAPI reserialization changed JSON bytes while the manifest hashes identified raw artifact bytes. The text/timings endpoints now preserve those bytes; the regression test compares HTTP content with the stored artifact. Evidence: `evidence/offline-library-and-playback/automated-python.txt` | Hash exact transmitted bytes. Do not hash semantically equivalent reserialized JSON. |
| E7 | Complete real-item offline workflow | C3 | The controlled Chromium runner passed explicit download, cache exclusion, two cold offline restarts, library/reader, playback, speed and position restoration, offline removal, and online server-item preservation. Evidence: `evidence/offline-library-and-playback/browser-result.json` | The selected download/index/service-worker design is viable in Chromium. Keep Android acceptance blocked until the maintainer runs it. |
| E8 | Full deterministic regression | C3 | 199 JavaScript tests, syntax checks, and 192 Python tests pass. Evidence: `automated-javascript.txt` and `automated-python.txt` in the issue evidence directory | Preserve the result in the reviewable implementation; rerun after any review change. |
| E9 | Independent implementation review | C3 | The first review found four no-pass items: shallow cached-body checks, post-publication observer cleanup, refresh/download races, and all-lost recovery. Corrections and deferred/corruption tests were applied to code commit `4ed9aad2ca11b0412f0cfe57c12b161a4fdc6e95`. The same reviewer reported no substantive findings on re-review. | All first-round no-pass items are resolved. Keep final CI in the PR discussion and target-phone acceptance blocked pending the maintainer. |

### Next candidates

- [x] Implement the linked general spec with deterministic integrity, failure, and offline-restart tests.
- [x] Run real Chromium with controlled prepared items, complete downloads, full browser restarts, and disabled networking.
- [x] Resolve independent review findings and keep the automated/browser evidence current.
- [ ] Obtain target-phone acceptance evidence from the maintainer after the reviewable implementation is available.

### Linked specs

- `.internal/specs/13-offline-library-and-playback-general-spec.md`: defines the approved issue #13 implementation.
