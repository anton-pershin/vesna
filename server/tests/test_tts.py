"""Deterministic local-engine, loopback adapter, and TTS deadline tests."""

from __future__ import annotations

import http.client
from http.server import BaseHTTPRequestHandler, HTTPServer
import socket
import sys
import threading
import time

from fastapi.testclient import TestClient
import pytest

from conftest import make_wav
from vesna.config import validate_loopback_url
from vesna.tts import (
    CommandSpeechEngine,
    TtsClient,
    TtsError,
    create_tts_app,
    validate_wav,
)


def test_command_engine_requires_input_and_output_placeholders():
    with pytest.raises(ValueError, match="placeholders"):
        CommandSpeechEngine("engine --plain", timeout=1, max_output_bytes=100)


def test_command_engine_reads_text_file_and_returns_wav(tmp_path):
    script = tmp_path / "fake_engine.py"
    capture = tmp_path / "captured.txt"
    script.write_text(
        "import pathlib,sys,wave\n"
        "text=pathlib.Path(sys.argv[1]).read_text(encoding='utf-8')\n"
        "pathlib.Path(sys.argv[3]).write_text(text,encoding='utf-8')\n"
        "w=wave.open(sys.argv[2],'wb');w.setnchannels(1);w.setsampwidth(2);"
        "w.setframerate(24000);w.writeframes(b'\\x01\\x00'*2400);w.close()\n",
        encoding="utf-8",
    )
    engine = CommandSpeechEngine(
        f"{sys.executable} {script} {{input}} {{output}} {capture}",
        timeout=2,
        max_output_bytes=100_000,
    )
    audio = engine.synthesize("Hello, 世界")
    validate_wav(audio)
    assert capture.read_text(encoding="utf-8") == "Hello, 世界"


def test_command_engine_failure_missing_output_and_timeout(tmp_path):
    failing = tmp_path / "failing.py"
    failing.write_text("raise SystemExit(7)\n", encoding="utf-8")
    engine = CommandSpeechEngine(
        f"{sys.executable} {failing} {{input}} {{output}}",
        timeout=1,
        max_output_bytes=1000,
    )
    with pytest.raises(TtsError, match="failed"):
        engine.synthesize("text")

    missing = tmp_path / "missing.py"
    missing.write_text("pass\n", encoding="utf-8")
    engine = CommandSpeechEngine(
        f"{sys.executable} {missing} {{input}} {{output}}",
        timeout=1,
        max_output_bytes=1000,
    )
    with pytest.raises(TtsError, match="did not produce"):
        engine.synthesize("text")

    stalled = tmp_path / "stalled.py"
    stalled.write_text("import time;time.sleep(2)\n", encoding="utf-8")
    engine = CommandSpeechEngine(
        f"{sys.executable} {stalled} {{input}} {{output}}",
        timeout=0.05,
        max_output_bytes=1000,
    )
    started = time.monotonic()
    with pytest.raises(TtsError) as caught:
        engine.synthesize("text")
    assert caught.value.category == "timeout"
    assert time.monotonic() - started < 1


def test_private_adapter_uses_injected_fake_engine(settings):
    class Engine:
        def synthesize(self, text):
            return make_wav()

    with TestClient(create_tts_app(settings, engine=Engine())) as client:
        response = client.post("/synthesize", json={"text": "paragraph"})
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("audio/wav")
        validate_wav(response.content)
        assert response.headers["cache-control"] == "no-store"
        assert client.post("/synthesize", json={"text": " "}).status_code == 422


def test_private_adapter_sanitizes_engine_errors(settings):
    class Engine:
        def synthesize(self, text):
            raise TtsError("Speech service failed.")

    with TestClient(create_tts_app(settings, engine=Engine())) as client:
        response = client.post("/synthesize", json={"text": "paragraph"})
    assert response.status_code == 503
    assert response.json() == {"detail": "Speech service failed."}


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:8765/synthesize",
        "http://0.0.0.0:8765/synthesize",
        "http://192.168.1.2/synthesize",
        "https://127.0.0.1/synthesize",
        "http://user@127.0.0.1/synthesize",
        "http://127.0.0.1:8765/",
        "http://127.0.0.1:8765/synthesize?key=secret",
    ],
)
def test_tts_client_rejects_non_loopback_or_ambiguous_destinations(url):
    with pytest.raises(ValueError):
        validate_loopback_url(url)


def test_tts_client_connection_timeout_is_categorized(monkeypatch):
    def timeout(self):
        raise socket.timeout()

    monkeypatch.setattr(http.client.HTTPConnection, "connect", timeout)
    client = TtsClient(
        "http://127.0.0.1:8765/synthesize",
        connect_timeout=0.01,
        overall_timeout=0.1,
        max_response_bytes=1000,
    )
    with pytest.raises(TtsError) as caught:
        client.synthesize("text")
    assert caught.value.category == "timeout"


def run_controlled_server(handler):
    server = HTTPServer(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, thread


def test_tts_client_overall_deadline_covers_stalled_response():
    class Stalled(BaseHTTPRequestHandler):
        def do_POST(self):
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", "10")
            self.end_headers()
            time.sleep(0.3)

        def log_message(self, *args):
            pass

    server, thread = run_controlled_server(Stalled)
    try:
        client = TtsClient(
            f"http://127.0.0.1:{server.server_port}/synthesize",
            connect_timeout=0.1,
            overall_timeout=0.05,
            max_response_bytes=1000,
        )
        started = time.monotonic()
        with pytest.raises(TtsError) as caught:
            client.synthesize("text")
        assert caught.value.category == "timeout"
        assert time.monotonic() - started < 0.25
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_tts_client_overall_deadline_bounds_slow_drip_bytes():
    class Dripping(BaseHTTPRequestHandler):
        def do_POST(self):
            self.send_response(200)
            self.send_header("Content-Length", "6")
            self.end_headers()
            for _ in range(6):
                try:
                    self.wfile.write(b"x")
                    self.wfile.flush()
                except BrokenPipeError:
                    break
                time.sleep(0.03)

        def log_message(self, *args):
            pass

    server, thread = run_controlled_server(Dripping)
    try:
        client = TtsClient(
            f"http://127.0.0.1:{server.server_port}/synthesize",
            connect_timeout=0.1,
            overall_timeout=0.07,
            max_response_bytes=1000,
        )
        started = time.monotonic()
        with pytest.raises(TtsError) as caught:
            client.synthesize("text")
        assert caught.value.category == "timeout"
        assert time.monotonic() - started < 0.16
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_tts_client_success_and_response_size_limit():
    audio = make_wav()

    class Success(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers["Content-Length"])
            self.rfile.read(length)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.end_headers()
            self.wfile.write(audio)

        def log_message(self, *args):
            pass

    server, thread = run_controlled_server(Success)
    try:
        url = f"http://127.0.0.1:{server.server_port}/synthesize"
        client = TtsClient(
            url, connect_timeout=0.2, overall_timeout=1, max_response_bytes=len(audio)
        )
        assert client.synthesize("text") == audio
        limited = TtsClient(
            url, connect_timeout=0.2, overall_timeout=1, max_response_bytes=10
        )
        with pytest.raises(TtsError, match="size limit"):
            limited.synthesize("text")
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=1)


def test_invalid_wav_is_rejected():
    with pytest.raises(TtsError):
        validate_wav(b"not a WAV")
