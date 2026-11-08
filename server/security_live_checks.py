#!/usr/bin/env python3
"""Run live protected-fetch rejection checks with controlled listeners."""

import argparse
import json
import socket
import threading
import time
from pathlib import Path
from urllib.parse import quote

import requests

from comourat.enrichment.page_fetch import PageFetcher
from comourat.fetch import FetchPolicyError
from vesna.live_config import make_live_fetch_policy


class ControlledListener:
    """Record TCP connections without exposing any application service."""

    def __init__(self, host: str) -> None:
        family = socket.AF_INET6 if ":" in host else socket.AF_INET
        self.socket = socket.socket(family, socket.SOCK_STREAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.socket.bind((host, 0))
        self.socket.listen()
        self.socket.settimeout(0.05)
        self.host = host
        self.port = self.socket.getsockname()[1]
        self.connections = 0
        self._count_lock = threading.Lock()
        self.running = True
        self.thread = threading.Thread(target=self._accept, daemon=True)
        self.thread.start()

    def _accept(self) -> None:
        while self.running:
            try:
                connection, _ = self.socket.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            with self._count_lock:
                self.connections += 1
            connection.close()

    def count(self) -> int:
        with self._count_lock:
            return self.connections

    def verify(self) -> None:
        with socket.create_connection((self.host, self.port), timeout=1):
            pass
        deadline = time.monotonic() + 1
        while self.count() < 1 and time.monotonic() < deadline:
            time.sleep(0.01)
        if self.count() != 1:
            raise RuntimeError("controlled listener did not record its control connection")
        with self._count_lock:
            self.connections = 0

    def drain(self) -> int:
        """Allow pending accepts to finish, then return the final count."""
        time.sleep(0.1)
        self.running = False
        self.socket.close()
        self.thread.join(timeout=1)
        return self.count()

    def close(self) -> None:
        self.running = False
        self.socket.close()
        self.thread.join(timeout=1)


def has_policy_cause(error: BaseException) -> bool:
    seen = set()
    current = error
    while current is not None and id(current) not in seen:
        if isinstance(current, FetchPolicyError):
            return True
        seen.add(id(current))
        current = current.__cause__ or current.__context__
    return False


def rejection_check(url: str, listener: ControlledListener) -> dict:
    fetcher = PageFetcher(connection_timeout=2, operation_timeout=15)
    try:
        fetcher.fetch(url)
    except Exception as error:
        connections = listener.drain()
        if has_policy_cause(error) and connections == 0:
            return {"status": "pass", "connections": 0, "detail": "policy rejected before connection"}
        return {"status": "fail", "connections": connections, "detail": "target was not rejected by policy"}
    connections = listener.drain()
    return {"status": "fail", "connections": connections, "detail": "target unexpectedly succeeded"}


def redirect_source_works(url: str, target: str) -> bool:
    try:
        with requests.get(url, allow_redirects=False, timeout=10) as response:
            return (
                response.status_code in {301, 302, 303, 307, 308}
                and response.headers.get("Location") == target
            )
    except requests.RequestException:
        return False


def redirect_check(url: str, listener: ControlledListener, target: str) -> dict:
    if not redirect_source_works(url, target):
        connections = listener.drain()
        return {"status": "blocked", "connections": connections, "detail": "redirect source did not return the controlled target"}
    fetcher = PageFetcher(connection_timeout=2, operation_timeout=15)
    try:
        fetcher.fetch(url)
    except Exception as error:
        connections = listener.drain()
        if has_policy_cause(error) and connections == 0:
            return {"status": "pass", "connections": 0, "detail": "policy rejected the redirect target before connection"}
        if not has_policy_cause(error) and not redirect_source_works(url, target):
            return {"status": "blocked", "connections": connections, "detail": "redirect source became unavailable"}
        return {"status": "fail", "connections": connections, "detail": "redirect target was not rejected by policy"}
    connections = listener.drain()
    return {"status": "fail", "connections": connections, "detail": "redirect target unexpectedly succeeded"}


def tts_deny_check(tts_host: str) -> dict:
    fetcher = PageFetcher(fetch_policy=make_live_fetch_policy(tts_host))
    try:
        fetcher.fetch(f"http://{tts_host}/")
    except Exception as error:
        if has_policy_cause(error):
            return {"status": "pass", "detail": "shared integration policy denied TTS before resolution"}
        return {"status": "fail", "detail": "TTS host was not denied by shared policy"}
    return {"status": "fail", "detail": "TTS host unexpectedly succeeded"}


def target_for(host: str, port: int) -> str:
    if ":" in host:
        return f"http://[{host}]:{port}/"
    return f"http://{host}:{port}/"


def run_one_check(host: str, kind: str, redirect_base: str | None) -> dict:
    name = f"{kind}_{host}"
    try:
        listener = ControlledListener(host)
    except OSError:
        return {"check": name, "status": "blocked", "detail": "address family unavailable"}
    try:
        listener.verify()
        target = target_for(host, listener.port)
        if kind == "direct":
            result = rejection_check(target, listener)
        else:
            url = f"{redirect_base}?url={quote(target, safe='')}"
            result = redirect_check(url, listener, target)
        result["check"] = name
        return result
    except Exception:
        connections = listener.drain()
        return {"check": name, "status": "blocked", "connections": connections, "detail": "listener control failed"}
    finally:
        listener.close()


def run_checks(redirect_base: str, tts_host: str) -> list[dict]:
    results = []
    for host in ("127.0.0.1", "::1"):
        results.append(run_one_check(host, "direct", None))
        results.append(run_one_check(host, "redirect", redirect_base))
    tts = tts_deny_check(tts_host)
    tts["check"] = "explicit_tts_deny"
    results.append(tts)
    return results


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--redirect-base", default="https://httpbin.org/redirect-to")
    parser.add_argument("--tts-host", default="vesna-test-tts.invalid")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    results = run_checks(args.redirect_base, args.tts_host)
    payload = json.dumps(results, indent=2)
    print(payload)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(payload + "\n", encoding="utf-8")
    if any(result["status"] == "fail" for result in results):
        return 1
    if any(result["status"] == "blocked" for result in results):
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
