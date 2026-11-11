# Isolated M1 playback probe

This directory contains the synthetic M1 playback fixture and its offline test interface. It is not the M3 application. Do not use it for private items or real-item offline checks.

The probe uses the canonical shared modules in `public/modules/`. Its server maps those modules at runtime. It does not copy their source.

## Serve the probe

From the repository root, run:

```sh
npm run serve:probe
```

The server listens on `127.0.0.1:8081`. The direct command is:

```sh
python3 probe/static_server.py --bind 127.0.0.1 --port 8081
```

To make a separate temporary HTTPS origin for device tests, run this command in a second terminal:

```sh
cloudflared tunnel --url http://127.0.0.1:8081
```

Use the printed HTTPS URL on the test device. This tunnel must be separate from the M3 application tunnel. The two origins must not share an installation, service worker, cache, or browser storage.

A changed Quick Tunnel URL is a changed origin. Install the probe again and repeat the offline preparation step after a URL change. Select **Prepare offline fixture** before offline playback tests.
