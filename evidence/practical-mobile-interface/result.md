# Practical mobile interface result

Status: **pass — M4 practical mobile interface is complete and ready to merge**

## Test identity

- Spec commit: `9adfc43`
- Final implementation commit: `ec8daf654b9b89ccf8e18ad13300456371b5db17`
- Visible target-phone build for device procedures: `54b5c7a2`; later focus-only fix: `ec8daf65`
- Comourat commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Python: `3.12.3`
- Node: `26.8.1`
- Chromium: `141.0.7390.37`
- Cloudflared: `2026.10.7`
- FFmpeg: `6.1.1-3ubuntu5`
- TTS: `piper-tts==1.8.0`, `onnxruntime==1.31.1`
- Voice: `en_US-joe-medium`, revision `cf910fb59f1d79ab3b625a63993a108751c6c25d`
- Hosted CI: pass, run `43550939264` at head `ec8daf6`
- Phone: `Android 12; LMR-LX9 Build/HUAWEILMR-L29; 31; REL`, Chrome `138.0.7204.157`
- Application origin: `https://record-candidates-img-hwy.trycloudflare.com`
- Isolated probe origin and build: `https://zip-shortly-str-robertson.trycloudflare.com`, `2026-11-13-m4-r10`

Additional versions and public configuration are in `environment.json`. Credentials are not recorded.

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Screen navigation and content submission | pass | Deterministic tests cover focused screens, true duplicate sharing, rejection of distinct pending submissions, and accepted-item opening. Live Chromium and the target phone passed real article and Markdown submission and playback. |
| AC2 Library and status presentation | pass | Fixtures cover every preparation state, concise messages, refresh behavior, and focus preservation, including Retry-to-Open fallback. Live polling preserved focus, source disclosure, and a nonzero reading position. |
| AC3 Reader, source inspection, and deletion interaction | pass | Source details load on demand and remain inert. Cancel and Escape preserved active playback and focus. Confirmed deletion stopped playback, cleared state, removed the item, and denied its source/audio. Held library, item, source, and prepared responses could not restore deleted content. |
| AC4 Bottom playback bar and preserved playback | pass | Real Chromium verified one visible control set, direct seek, play/pause, previous/next/selected paragraphs, speed, actual auto-scroll, saved position and speed, a one-second highlight bound, and no scrolling-triggered audio requests. The user confirmed the A → B → restored A highlight regression is fixed. |
| AC5 Responsive design and accessibility | pass | Static contrast checks and browser geometry covered phone, desktop, 320px, long content, and 200% text scaling. Open Source panel bounds are inside every tested viewport. All visible primary targets measured at least 44px. Focus, reduced motion, non-live time, A1 icon hashes, and sign-in/failure screenshots passed. |
| AC6 Regression, deletion safety, security, and maintainability | pass | 184 Python and 147 JavaScript tests pass. Backend tests cover every preparation state and required deletion race. Browser tests cover authentication termination, old-session responses, lost responses, stale reads, and navigation races. No private response was cached. Independent implementation reviews found no remaining substantive issues. |
| AC7 Live browser and target-phone verification | pass | Expanded Chromium 141 checks pass. The target phone passed both input workflows, playback, background/locked-screen behavior, deletion, sign-out, and visual acceptance. The isolated probe passed update preservation and a 30-minute offline locked-screen run at 17:50–18:20 on 2026-11-13. |
| AC8 Evidence and milestone decision | pass | This directory contains exact identities, automated and live results, reproduction instructions, sanitized screenshots, CI results, and target-phone observations. AC1–AC7 pass. |

## Automated and hosted results

- `automated-python.txt`: **184 passed, 0 failed**.
- `automated-javascript.txt`: **147 passed, 0 failed**, plus syntax checks.
- Locked installation completed with `vesna==0.4.0` and the pinned comourat commit.
- Hosted CI run `43550939264` at `ec8daf6`: **pass**, with 184 Python application tests, 619 comourat tests, and 147 JavaScript tests.

## Live browser results

`browser-result.json` records a passing Chromium run with real article and Markdown preparation, audio playback and restoration, direct seek, actual automatic scrolling, one-second highlighting, deletion cancellation and confirmation, stale-response rejection, focus preservation, all visible primary touch targets, and private-cache exclusion.

The A → B → restored A playback scenario is included as `article_to_item_to_article_highlight: true`. The screenshots in `screenshots/` contain only public test content and explicit public layout fixtures.

## Target-phone results

`device-results.md` records the passing M4 application procedure, the corrected highlight, shell-update, and Source-panel regressions, final visible build `54b5c7a2`, unchanged Android/Chrome versions, and the successful 17:50–18:20 offline locked-screen probe run on build `2026-11-13-m4-r10`. The user explicitly confirmed the corrected Source panel on the phone.

## Milestone decision

`pass`. M4 delivers the approved A1 practical mobile interface and safe item deletion. All AC1–AC8 checks pass. M4 is **Done** in the constitution roadmap on this implementation branch, and the implementation is ready to merge in PR #10.
