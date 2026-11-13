# M4 verification evidence

This directory records complete acceptance evidence for the practical mobile interface. M4 passes all AC1–AC8 criteria. Historical procedures explain failures that were corrected before the final pass; a pending or blocked result is never a pass.

## Evidence rules

Record exact commits, dependency and browser versions, public temporary origins, reproduction commands, and explicit outcomes. Keep passwords, password hashes, session cookies, authentication responses, private generation endpoints, item identifiers, and unintended private content out of the evidence.

`browser-result.json` and the screenshots use public example content and explicit public layout fixtures. Runtime credentials and copied test databases remain outside the repository.

## Automated checks

From the repository root:

```sh
npm test
npm run check:syntax
UV_PROJECT_ENVIRONMENT=/tmp/opencode/vesna-m4-lock-venv uv sync --project server --extra test --extra tts --locked
/tmp/opencode/vesna-m4-lock-venv/bin/python -m pytest server/tests
```

Raw results are in `automated-python.txt` and `automated-javascript.txt`.

## Live Chromium check

Use the versioned runner with externally supplied credentials and Playwright:

```sh
export VESNA_PUBLIC_ORIGIN=https://record-candidates-img-hwy.trycloudflare.com
export PLAYWRIGHT_MODULE=/tmp/opencode/vesna-m3-browser/node_modules/playwright
export CHROMIUM_EXECUTABLE=/tmp/opencode/vesna-m3-browser/chromium-1194/chrome-linux/chrome
export VESNA_BROWSER_RESULT=/tmp/opencode/vesna-m4-live/browser-result.json
export VESNA_BROWSER_SCREENSHOT_DIR=/tmp/opencode/vesna-m4-live/screenshots
node deploy/browser_live_check.cjs
```

Read the password into `VESNA_PASSWORD` without logging it. The runner creates real article and Markdown jobs and deletes only its uniquely named disposable Markdown item. Do not run it against a library containing data you are not prepared to modify.

## Device and acceptance records

- `device-results.md`: required target-phone and isolated-probe procedures and current observations.
- `ci-results.json`: hosted-CI identity and result.
- `result.md`: AC1–AC8 dispositions and the milestone decision.
