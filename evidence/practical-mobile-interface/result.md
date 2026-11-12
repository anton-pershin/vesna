# Practical mobile interface result

Status: **in progress — target-phone checks remain; hosted CI passes**

## Test identity

- Vesna commit: `aee1aa71c65752a930c4083091b58ed2f2a9b36c`
- Implementation commit before the isolated-probe bump: `736bafd`
- Comourat commit: `c9bfb1604a5286d073aaceef1513e0d7496d0e33`
- Python: `3.12.3`
- Node: `26.8.1`
- Chromium: `141.0.7390.37`
- Temporary application origin: `https://record-candidates-img-hwy.trycloudflare.com`
- Isolated probe origin and build: `https://zip-shortly-str-robertson.trycloudflare.com`, `2026-11-12-m4-r8`

Additional versions and public configuration are in `environment.json`. Credentials are not recorded.

## Acceptance record

| Criterion | Result | Raw observation |
|---|---|---|
| AC1 Screen navigation and content submission | pass | Controller tests cover focused screens, equivalent and distinct pending submissions, and accepted-item opening. Live Chromium submits a real article and Markdown item through separate input states and opens the correct result. |
| AC2 Library and status presentation | pass | Fixtures cover all preparation states, concise messages, refresh behavior, focus preservation, and Retry-to-Open fallback. Live polling preserves focus, source disclosure, and a nonzero reading position. |
| AC3 Reader, source inspection, and deletion interaction | pass | Source details load on demand and remain inert. Cancel and Escape preserve active playback and focus. Deletion stops playback, clears state, and denies artifacts. Held item, source, and prepared responses cannot restore deleted content. |
| AC4 Bottom playback bar and preserved playback | pass | Real Chromium verifies one visible control set, direct seek, play/pause, previous/next/selected paragraphs, speed, actual auto-scroll, saved position and speed, a one-second highlight bound, and no scrolling-triggered audio requests. |
| AC5 Responsive design and accessibility | pass | Static contrast checks and browser geometry cover phone, desktop, 320px, long content, and 200% text scaling. Visible primary targets measure at least 44px. Focus, reduced motion, non-live time, and A1 icon hashes pass. |
| AC6 Regression, deletion safety, security, and maintainability | pass | 182 Python and 142 JavaScript tests pass. Backend tests cover every preparation state and required deletion race. Browser tests cover authentication termination, lost responses, stale reads, and navigation races. No private response is cached. Independent code re-review has no remaining substantive issues. |
| AC7 Live browser and target-phone verification | pending | The expanded live Chromium run passes. Target-phone input, playback, background/locked-screen, deletion, visual acceptance, and isolated-probe preservation procedures are not yet performed. |
| AC8 Evidence and milestone decision | pending | Evidence is being assembled. Hosted CI run `43160349764` passes with 182 Python application tests, 619 comourat tests, and 142 JavaScript tests. M4 cannot pass until AC7 and the final evidence review pass. |

## Automated results

- `automated-python.txt`: **182 passed, 0 failed**.
- `automated-javascript.txt`: **142 passed, 0 failed**, plus syntax checks.
- Locked installation with `UV_PROJECT_ENVIRONMENT=/tmp/opencode/vesna-m4-lock-venv uv sync --project server --extra test --extra tts --locked` completed with `vesna==0.4.0` and the pinned comourat commit.
- Hosted CI run `43160349764` at `aee1aa7`: **pass**, with 182 Python application tests, 619 comourat tests, and 142 JavaScript tests.

## Live browser results

`browser-result.json` records a passing Chromium run with real article and Markdown preparation, audio playback and restoration, direct seek, actual automatic scrolling, one-second highlighting, deletion cancellation and confirmation, stale-response rejection, focus preservation, all visible primary touch targets, and private-cache exclusion.

The `screenshots/` directory contains sanitized mobile and desktop screens with public test content only. The long title, URL, filename, paragraph, and error strings are explicit public layout fixtures, not private content.

## Pending work

1. Complete `device-results.md` on the target phone.
2. Confirm isolated-probe `2026-11-12-m4-r8` update and offline preservation.
3. Update this record and obtain the final independent acceptance review.

M4 is **not Done** while these checks remain pending.
