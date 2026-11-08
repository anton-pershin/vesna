#!/usr/bin/env python3
"""Temporary public redirect source for loopback-only security checks."""

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit


class LoopbackRedirectHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        target = parse_qs(urlsplit(self.path).query).get("url", [""])[0]
        if not (target.startswith("http://127.0.0.1") or target.startswith("http://[::1]")):
            self.send_error(400)
            return
        self.send_response(302)
        self.send_header("Location", target)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind, args.port), LoopbackRedirectHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
