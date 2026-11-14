# Single-machine deployment (M3 and M4)

This procedure runs the application, worker, storage, and TTS on one development machine. Cloudflare Quick Tunnel provides a temporary public HTTPS origin. No domain or inbound port 443 is required. This is not the final stable or split-host deployment.

## Required versions and accounts

The verified development configuration uses:

- Ubuntu 24.04 and systemd 255.
- Python 3.12.3 and `uv 0.13.6`.
- Node.js 24 for JavaScript checks; no npm runtime packages are used by the application.
- FFmpeg and FFprobe `6.1.1-3ubuntu5`.
- `cloudflared 2026.10.7`.
- `piper-tts==1.8.0` and `onnxruntime==1.31.1`.
- Piper `en_US-joe-medium` at revision `cf910fb59f1d79ab3b625a63993a108751c6c25d`.

A Quick Tunnel requires no Cloudflare account. Cloudflare terminates public TLS and provides no uptime guarantee. A changed temporary URL creates a new browser origin, installation, sign-in, and browser-local playback state.

Install missing tools from their official packages. For example, the verified Cloudflare package is:

```sh
curl --fail --location \
  https://github.com/cloudflare/cloudflared/releases/download/2026.10.7/cloudflared-linux-amd64.deb \
  --output /tmp/cloudflared-linux-amd64.deb
sudo dpkg -i /tmp/cloudflared-linux-amd64.deb
cloudflared --version
sudo apt-get install -y ffmpeg
```

Install `uv 0.13.6` from the official Astral installation procedure and confirm `uv --version`.

## Clean-checkout installation

Use a clean checkout at `/opt/vesna`:

```sh
sudo git clone https://github.com/anton-pershin/vesna.git /opt/vesna
cd /opt/vesna
git checkout 54b5c7a2bf09aace3b56acc54eb81df72e818fd9
UV_PROJECT_ENVIRONMENT=/opt/vesna/venv uv sync --project server --extra tts --locked
bash deploy/install_joe_model.sh
```

The model script downloads only public HTTPS files and verifies the ONNX SHA-256 before installation. Keep the downloaded `MODEL_CARD` with the model.

Create the service account, data directory, and secret directory:

```sh
sudo useradd --system --home-dir /var/lib/vesna --shell /usr/sbin/nologin vesna
sudo install -d -o vesna -g vesna /var/lib/vesna
sudo install -d -m 0700 /etc/vesna
sudo cp deploy/vesna-api.env.example /etc/vesna/api.env
sudo cp deploy/vesna-worker.env.example /etc/vesna/worker.env
sudo cp deploy/vesna-tts.env.example /etc/vesna/tts.env
sudo chmod 0600 /etc/vesna/*.env
```

Generate the password hash interactively. Do not put the password in an argument, log, or repository file:

```sh
/opt/vesna/venv/bin/vesna-password-hash
```

Put only the resulting hash in `/etc/vesna/api.env`. The worker does not receive that hash. The TTS command is confined to `/etc/vesna/tts.env`.

## Start the Quick Tunnel and application

Start the connector first and keep its terminal open:

```sh
cloudflared tunnel --url http://127.0.0.1:8000 --no-autoupdate
```

Copy the printed `https://…trycloudflare.com` origin into `VESNA_PUBLIC_ORIGIN` in `/etc/vesna/api.env`. Use only the origin, without a path, query, or fragment. Set `VESNA_BUILD_COMMIT` to the running Git commit from `git rev-parse HEAD`; the public `/api/build` endpoint and small header label use it for update verification. Static shell resources send `Cache-Control: no-cache` so the service worker and modules revalidate. Then install and start the services:

```sh
sudo cp deploy/vesna-api.service deploy/vesna-worker.service deploy/vesna-tts.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vesna-tts.service vesna-api.service vesna-worker.service
systemd-analyze verify /opt/vesna/deploy/vesna-api.service /opt/vesna/deploy/vesna-worker.service /opt/vesna/deploy/vesna-tts.service
```

Run exactly one worker. API and TTS listen only on loopback. The Quick Tunnel exposes only port 8000 and never TTS port 8765. Check the listeners and public authentication boundary:

```sh
ss -ltnp '( sport = :8000 or sport = :8765 )'
curl --include https://TEMPORARY_ORIGIN/api/items
```

The listener addresses must be `127.0.0.1` or `::1`. The unauthenticated API request must return `401`, not private data.

If the Quick Tunnel URL changes, update `VESNA_PUBLIC_ORIGIN`, restart `vesna-api`, and install/sign in again on the phone. Do not reuse browser-local state from a different origin.

## Live source and artifact checks

Read the password into the environment without echoing it:

```sh
read -rsp 'Vesna password: ' VESNA_PASSWORD
export VESNA_PASSWORD
```

Run the versioned live runner against the current public origin:

```sh
/opt/vesna/venv/bin/python /opt/vesna/server/application_live_checks.py \
  --public-origin https://TEMPORARY_ORIGIN \
  --markdown-file /opt/vesna/evidence/first-usable-listening-application/sample.markdown \
  --output /tmp/vesna-live-source-results.json
```

The runner verifies public article extraction, Markdown preservation, real prepared audio and timings, preparation after the submitting client disconnects, unauthenticated denial, sign-out, and `206`/`416` audio ranges. Its output contains no password, cookie, item identifier, or private TTS address.

## Live Chromium check

Install Playwright only in a temporary verification directory:

```sh
npm install --prefix /tmp/vesna-browser playwright@1.56.1
/tmp/vesna-browser/node_modules/.bin/playwright install chromium
```

After the live source runner has prepared `sample.markdown`, run:

```sh
export PLAYWRIGHT_MODULE=/tmp/vesna-browser/node_modules/playwright
export VESNA_PUBLIC_ORIGIN=https://TEMPORARY_ORIGIN
export VESNA_BROWSER_RESULT=/tmp/vesna-browser-result.json
node /opt/vesna/deploy/browser_live_check.cjs
```

Set `VESNA_BROWSER_SCREENSHOT_DIR` to a directory if sanitized phone and desktop screenshots are needed. Set `CHROMIUM_EXECUTABLE` only when using a custom Chromium installation. The check covers focused screens, article and Markdown submission, real audio decoding and playback, navigation, selected paragraphs, speed, restore, source inspection, bottom-bar geometry, touch targets, 200% text scaling, private-cache exclusion, and cancellation/confirmation of a uniquely named disposable deletion item. It creates real preparation jobs and deletes only that disposable Markdown item.

## Controlled redirect security checks

Use a separate controlled redirect fixture and a separate Quick Tunnel. Do not expose TTS through this fixture.

Terminal one:

```sh
/opt/vesna/venv/bin/python /opt/vesna/server/redirect_fixture.py --bind 127.0.0.1 --port 8766
```

Terminal two:

```sh
cloudflared tunnel --url http://127.0.0.1:8766 --no-autoupdate
```

Use the printed redirect origin in this command:

```sh
PYTHONPATH=/opt/vesna/server/src /opt/vesna/venv/bin/python \
  /opt/vesna/server/security_live_checks.py \
  --redirect-base https://TEMPORARY_REDIRECT_ORIGIN/ \
  --tts-host 127.0.0.1 \
  --output /tmp/vesna-live-security-results.json
```

All direct and redirect results must pass with zero prohibited connections. A blocked redirect source is not a pass.

## Target-phone checks

Follow `evidence/first-usable-listening-application/README.md`. Use mobile data or another external network for the real remote-access check. Run the synthetic M1 regression probe from `probe/README.md` on a different origin from the application. Record unavailable controls explicitly, and do not claim real-item offline readiness from the probe result.

## Secret and runtime-file handling

Keep `/etc/vesna/*.env` at mode `0600`. Do not commit those files, generated hashes, session cookies, temporary credentials, models, SQLite files, or generated artifacts. The repository ignore rules cover common local runtime locations, but operators must also protect external secret and data directories.
