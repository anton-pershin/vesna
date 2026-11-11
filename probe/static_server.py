#!/usr/bin/env python3
"""Serve static probe files with HTTP single-range support."""

import argparse
import os
import re
import ssl
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit


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
    requested_end = int(last) if last else None
    if requested_end is not None and requested_end < start:
        return _IGNORE_RANGE
    if start >= size:
        return None
    end = size - 1 if requested_end is None else min(requested_end, size - 1)
    return start, end


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

    def setup(self):
        self.request.settimeout(30)
        super().setup()

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        # Service-worker updates and shell module requests must revalidate.
        # CacheStorage still provides the explicit offline fixture behavior.
        self.send_header("Cache-Control", "no-cache")
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


class ProbeRequestHandler(RangeRequestHandler):
    """Serve the isolated probe and alias canonical shared browser modules."""

    def __init__(self, *args, shared_modules, probe_modules, **kwargs):
        self.shared_modules = shared_modules
        self.probe_modules = probe_modules
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        request_path = urlsplit(path).path
        original_directory = self.directory
        try:
            for prefix, directory in (
                ("/modules/", self.shared_modules),
                ("/probe-modules/", self.probe_modules),
            ):
                if request_path.startswith(prefix):
                    self.directory = directory
                    path = request_path[len(prefix):]
                    break
            return super().translate_path(path)
        finally:
            self.directory = original_directory


class StaticThreadingHTTPServer(ThreadingHTTPServer):
    """Accept TCP connections without waiting for their TLS handshakes."""

    request_queue_size = 64

    def __init__(self, server_address, handler, ssl_context=None):
        self.ssl_context = ssl_context
        super().__init__(server_address, handler)

    def get_request(self):
        request, address = super().get_request()
        if self.ssl_context is not None:
            request = self.ssl_context.wrap_socket(
                request,
                server_side=True,
                do_handshake_on_connect=False,
            )
        return request, address


def main():
    probe_directory = Path(__file__).resolve().parent
    shared_modules = probe_directory.parent / "public" / "modules"
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bind", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8081)
    parser.add_argument("--directory", default=str(probe_directory))
    parser.add_argument("--shared-modules", default=str(shared_modules))
    parser.add_argument("--certificate")
    parser.add_argument("--key")
    args = parser.parse_args()
    if bool(args.certificate) != bool(args.key):
        parser.error("--certificate and --key must be used together")

    handler = partial(
        ProbeRequestHandler,
        directory=args.directory,
        shared_modules=args.shared_modules,
        probe_modules=str(Path(args.directory) / "modules"),
    )
    context = None
    scheme = "http"
    if args.certificate:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.certificate, args.key)
        scheme = "https"
    server = StaticThreadingHTTPServer((args.bind, args.port), handler, ssl_context=context)

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
