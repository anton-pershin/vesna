"""Loopback TTS HTTP adapter and a bounded sequential-worker HTTP client."""

from __future__ import annotations

import http.client
import io
import json
import os
from pathlib import Path
import shlex
import socket
import subprocess
import tempfile
import time
from typing import Protocol
from urllib.parse import urlsplit
import wave

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, ConfigDict, Field

from .config import Settings, validate_loopback_url


class TtsError(RuntimeError):
    def __init__(self, message: str, *, category: str = "provider") -> None:
        self.category = category
        super().__init__(message)


def validate_wav(data: bytes) -> None:
    if not data:
        raise TtsError("Speech service returned empty audio.")
    try:
        with wave.open(io.BytesIO(data), "rb") as wav:
            if (
                wav.getnchannels() < 1
                or wav.getframerate() < 8000
                or wav.getnframes() < 1
                or wav.getsampwidth() < 1
            ):
                raise TtsError("Speech service returned invalid audio.")
    except (wave.Error, EOFError) as error:
        raise TtsError("Speech service returned invalid audio.") from error


class SpeechEngine(Protocol):
    def synthesize(self, text: str) -> bytes: ...


class CommandSpeechEngine:
    """Invoke a configured local executable with text-file and WAV-file arguments.

    ``{input}`` and ``{output}`` placeholders are replaced in individual argv
    elements. The command is never passed through a shell and text never appears
    in process arguments.
    """

    def __init__(self, command: str, *, timeout: float, max_output_bytes: int) -> None:
        self.command = shlex.split(command)
        if not self.command:
            raise ValueError("TTS engine command must not be empty")
        if not any("{input}" in part for part in self.command) or not any(
            "{output}" in part for part in self.command
        ):
            raise ValueError("TTS engine command requires {input} and {output} placeholders")
        self.timeout = timeout
        self.max_output_bytes = max_output_bytes

    def synthesize(self, text: str) -> bytes:
        with tempfile.TemporaryDirectory(prefix="vesna-tts-") as directory:
            input_path = Path(directory, "input.txt")
            output_path = Path(directory, "output.wav")
            input_path.write_text(text, encoding="utf-8")
            argv = [
                part.replace("{input}", str(input_path)).replace("{output}", str(output_path))
                for part in self.command
            ]
            try:
                result = subprocess.run(
                    argv,
                    stdin=subprocess.DEVNULL,
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    timeout=self.timeout,
                    check=False,
                )
            except (subprocess.TimeoutExpired, OSError) as error:
                raise TtsError("Local speech engine failed.", category="timeout") from error
            if result.returncode != 0:
                raise TtsError("Local speech engine failed.")
            try:
                if output_path.stat().st_size > self.max_output_bytes:
                    raise TtsError("Local speech engine output exceeded the size limit.")
                data = output_path.read_bytes()
            except OSError as error:
                raise TtsError("Local speech engine did not produce audio.") from error
            validate_wav(data)
            return data


class TtsClient:
    def __init__(
        self,
        url: str,
        *,
        connect_timeout: float,
        overall_timeout: float,
        max_response_bytes: int,
    ) -> None:
        self.url = validate_loopback_url(url)
        self.parts = urlsplit(self.url)
        self.connect_timeout = connect_timeout
        self.overall_timeout = overall_timeout
        self.max_response_bytes = max_response_bytes

    def synthesize(self, text: str) -> bytes:
        started = time.monotonic()
        body = json.dumps({"text": text}, ensure_ascii=False).encode("utf-8")
        port = self.parts.port or 80
        connection = http.client.HTTPConnection(
            self.parts.hostname, port, timeout=min(self.connect_timeout, self.overall_timeout)
        )
        try:
            try:
                connection.connect()
            except (socket.timeout, TimeoutError) as error:
                raise TtsError("Speech service connection timed out.", category="timeout") from error
            except OSError as error:
                raise TtsError("Speech service is unavailable.", category="unavailable") from error
            self._set_remaining_timeout(connection, started)
            path = self.parts.path
            if self.parts.query:
                path += "?" + self.parts.query
            connection.request(
                "POST",
                path,
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Accept": "audio/wav",
                    "Connection": "close",
                },
            )
            self._set_remaining_timeout(connection, started)
            response = connection.getresponse()
            if response.status != 200:
                raise TtsError("Speech service rejected the request.")
            if response.length is not None and response.length > self.max_response_bytes:
                raise TtsError("Speech service response exceeded the size limit.")
            data = bytearray()
            while len(data) <= self.max_response_bytes:
                # read1 performs at most one underlying buffered read. Refreshing the
                # socket deadline between reads prevents an endless slow-drip response.
                self._set_remaining_timeout(connection, started)
                chunk = response.read1(min(65536, self.max_response_bytes + 1 - len(data)))
                if not chunk:
                    break
                data.extend(chunk)
            if time.monotonic() - started > self.overall_timeout:
                raise TtsError("Speech service exceeded the overall deadline.", category="timeout")
            if len(data) > self.max_response_bytes:
                raise TtsError("Speech service response exceeded the size limit.")
            result = bytes(data)
            validate_wav(result)
            return result
        except TtsError:
            raise
        except (socket.timeout, TimeoutError) as error:
            raise TtsError("Speech service exceeded the overall deadline.", category="timeout") from error
        except (OSError, http.client.HTTPException) as error:
            raise TtsError("Speech service failed.") from error
        finally:
            connection.close()

    def _set_remaining_timeout(self, connection: http.client.HTTPConnection, started: float) -> None:
        remaining = self.overall_timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise TtsError("Speech service exceeded the overall deadline.", category="timeout")
        if connection.sock is not None:
            connection.sock.settimeout(remaining)


class SynthesizeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=20_000)


def create_tts_app(settings: Settings, *, engine: SpeechEngine | None = None) -> FastAPI:
    if engine is None:
        settings.for_tts()
        engine = CommandSpeechEngine(
            settings.tts_engine_command,
            timeout=settings.tts_engine_timeout,
            max_output_bytes=settings.tts_response_max_bytes,
        )
    speech_engine = engine
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def private_response_headers(request, call_next):
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.post("/synthesize", response_class=Response)
    def synthesize(payload: SynthesizeRequest) -> Response:
        if not payload.text.strip():
            raise HTTPException(status_code=422, detail="Text must not be empty.")
        try:
            audio = speech_engine.synthesize(payload.text)
        except TtsError as error:
            status = 504 if error.category == "timeout" else 503
            return JSONResponse(status_code=status, content={"detail": str(error)})
        return Response(content=audio, media_type="audio/wav")

    return app


__all__ = [
    "CommandSpeechEngine",
    "SpeechEngine",
    "TtsClient",
    "TtsError",
    "create_tts_app",
    "validate_wav",
]
