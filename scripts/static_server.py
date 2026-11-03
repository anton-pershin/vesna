#!/usr/bin/env python3
"""Serve static probe files with HTTP single-range support."""

import argparse
import os
import re
import ssl
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


_RANGE_PATTERN = re.compile(r"^bytes=(.*)$", re.IGNORECASE)
_SINGLE_RANGE_PATTERN = re.compile(r"^(\d*)-(\d*)$")
_IGNORE_RANGE = object()


def parse_single_range(value, size):
    match = _SINGLE_RANGE_PATTERN.fullmatch(value.strip())
    if not match or (not match[1] and not match[2]):
        return _IGNORE_RANGE
    if size == 0:
        return None

    first, last = match.groups()
    if not first:
        suffix_length = int(last)
        if suffix_length <= 0:
            return None
        return max(size - suffix_length, 0), size - 1

    start = int(first)
    if start >= size:
        return None
    end = min(int(last), size - 1) if last else size - 1
    return (start, end) if end >= start else None


def parse_range(header, size):
    """Return offsets, None for unsatisfiable ranges, or the ignore marker."""
    match = _RANGE_PATTERN.fullmatch(header.strip())
    if not match:
        return _IGNORE_RANGE
    values = match[1].split(",")
    satisfiable = []
    for value in values:
        parsed = parse_single_range(value, size)
        if parsed is _IGNORE_RANGE:
            return _IGNORE_RANGE
        if parsed is not None:
            satisfiable.append(parsed)
    if not satisfiable:
        return None
    if len(values) > 1:
        return _IGNORE_RANGE
    return satisfiable[0]


class RangeRequestHandler(SimpleHTTPRequestHandler):
    """Serve ordinary files through SimpleHTTPRequestHandler and media ranges."""

    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        self._byte_range = None
        if self.headers.get("Range") is None:
            return super().send_head()

        path = self.translate_path(self.path)
        if not os.path.isfile(path):
            return super().send_head()

        try:
            source = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        stat = os.fstat(source.fileno())
        size = stat.st_size
        selected_range = parse_range(self.headers["Range"], size)
        if selected_range is _IGNORE_RANGE:
            source.close()
            return super().send_head()
        if selected_range is None:
            source.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        start, end = selected_range
        self._byte_range = selected_range
        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Last-Modified", self.date_time_string(stat.st_mtime))
        self.end_headers()
        return source

    def copyfile(self, source, outputfile):
        if self._byte_range is None:
            return super().copyfile(source, outputfile)

        start, end = self._byte_range
        source.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk = source.read(min(64 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--directory", default="public")
    parser.add_argument("--certificate")
    parser.add_argument("--key")
    args = parser.parse_args()
    if bool(args.certificate) != bool(args.key):
        parser.error("--certificate and --key must be used together")

    handler = partial(RangeRequestHandler, directory=args.directory)
    server = ThreadingHTTPServer((args.bind, args.port), handler)
    scheme = "http"
    if args.certificate:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.certificate, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
        scheme = "https"

    host, port = server.server_address[:2]
    print(f"Serving {args.directory} at {scheme}://{host}:{port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
