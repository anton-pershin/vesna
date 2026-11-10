"""Explicit, externally supplied configuration for the M3 processes."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import shlex
from urllib.parse import urlsplit
import ipaddress
import os


def _origin(value: str) -> str:
    value = value.strip().rstrip("/")
    parts = urlsplit(value)
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
        or parts.path
    ):
        raise ValueError("VESNA_PUBLIC_ORIGIN must be an HTTP(S) origin without a path")
    try:
        port = parts.port
    except ValueError as error:
        raise ValueError("VESNA_PUBLIC_ORIGIN has an invalid port") from error
    host = parts.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    default_port = 80 if parts.scheme == "http" else 443
    port_part = "" if port is None or port == default_port else f":{port}"
    return f"{parts.scheme}://{host}{port_part}"


def validate_loopback_url(value: str) -> str:
    """Require a literal loopback HTTP URL for the worker's private TTS client."""
    parts = urlsplit(value)
    if (
        parts.scheme != "http"
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
    ):
        raise ValueError("TTS URL must be an HTTP URL on a literal loopback address")
    try:
        address = ipaddress.ip_address(parts.hostname)
        parts.port
    except ValueError as error:
        raise ValueError("TTS URL has an invalid address or port") from error
    if not address.is_loopback:
        raise ValueError("TTS URL must use 127.0.0.1 or ::1")
    if not parts.path or parts.path == "/":
        raise ValueError("TTS URL must include a synthesis path")
    return value


@dataclass(frozen=True, slots=True)
class Settings:
    database_path: Path
    artifact_root: Path
    public_origin: str = "http://127.0.0.1"
    password_hash: str = ""
    static_dir: Path | None = None
    session_ttl_seconds: int = 604800
    upload_max_bytes: int = 1_048_576
    request_max_bytes: int = 1_261_568
    max_paragraphs: int = 500
    max_paragraph_chars: int = 20_000
    article_connection_timeout: float = 10.0
    article_read_timeout: float = 30.0
    article_overall_timeout: float = 60.0
    tts_url: str = "http://127.0.0.1:8765/synthesize"
    tts_connect_timeout: float = 2.0
    tts_overall_timeout: float = 120.0
    tts_response_max_bytes: int = 25_000_000
    tts_engine_command: str = ""
    tts_engine_timeout: float = 120.0
    worker_poll_seconds: float = 0.25
    worker_lease_seconds: float = 300.0
    voice_id: str = "local-default"
    ffmpeg_command: str = "ffmpeg"
    ffprobe_command: str = "ffprobe"

    def __post_init__(self) -> None:
        object.__setattr__(self, "database_path", Path(self.database_path))
        object.__setattr__(self, "artifact_root", Path(self.artifact_root))
        object.__setattr__(self, "public_origin", _origin(self.public_origin))
        if self.static_dir is not None:
            object.__setattr__(self, "static_dir", Path(self.static_dir))
        if self.password_hash and not self.password_hash.startswith("scrypt$"):
            raise ValueError("password hash must use the vesna scrypt format")
        if not self.voice_id.strip() or len(self.voice_id) > 200:
            raise ValueError("voice_id must be a non-empty public configuration identifier")
        for name in (
            "session_ttl_seconds",
            "upload_max_bytes",
            "request_max_bytes",
            "max_paragraphs",
            "max_paragraph_chars",
            "tts_response_max_bytes",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        if self.request_max_bytes < self.upload_max_bytes + 4096:
            raise ValueError("request limit must leave room for multipart framing")
        for name in (
            "article_connection_timeout",
            "article_read_timeout",
            "article_overall_timeout",
            "tts_connect_timeout",
            "tts_overall_timeout",
            "tts_engine_timeout",
            "worker_poll_seconds",
            "worker_lease_seconds",
        ):
            if getattr(self, name) <= 0:
                raise ValueError(f"{name} must be positive")
        validate_loopback_url(self.tts_url)

    @classmethod
    def from_env(cls, *, require_auth: bool = False) -> "Settings":
        """Read process configuration without logging any supplied values.

        Only the API requires authentication settings; workers and TTS can run
        without receiving the application's password hash.
        """
        public_origin = os.environ.get("VESNA_PUBLIC_ORIGIN")
        password_hash = os.environ.get("VESNA_PASSWORD_HASH")
        if require_auth and (not public_origin or not password_hash):
            raise ValueError(
                "VESNA_PUBLIC_ORIGIN and VESNA_PASSWORD_HASH must be supplied externally"
            )
        values: dict[str, object] = {
            "database_path": Path(os.environ.get("VESNA_DATABASE", "var/vesna.sqlite3")),
            "artifact_root": Path(os.environ.get("VESNA_ARTIFACT_ROOT", "var/artifacts")),
            "public_origin": public_origin or "http://127.0.0.1",
            "password_hash": password_hash or "",
            "static_dir": Path(os.environ["VESNA_STATIC_DIR"])
            if os.environ.get("VESNA_STATIC_DIR")
            else None,
        }
        scalar_names = {
            "VESNA_SESSION_TTL_SECONDS": ("session_ttl_seconds", int),
            "VESNA_UPLOAD_MAX_BYTES": ("upload_max_bytes", int),
            "VESNA_REQUEST_MAX_BYTES": ("request_max_bytes", int),
            "VESNA_MAX_PARAGRAPHS": ("max_paragraphs", int),
            "VESNA_MAX_PARAGRAPH_CHARS": ("max_paragraph_chars", int),
            "VESNA_ARTICLE_CONNECT_TIMEOUT": ("article_connection_timeout", float),
            "VESNA_ARTICLE_READ_TIMEOUT": ("article_read_timeout", float),
            "VESNA_ARTICLE_OVERALL_TIMEOUT": ("article_overall_timeout", float),
            "VESNA_TTS_URL": ("tts_url", str),
            "VESNA_TTS_CONNECT_TIMEOUT": ("tts_connect_timeout", float),
            "VESNA_TTS_OVERALL_TIMEOUT": ("tts_overall_timeout", float),
            "VESNA_TTS_RESPONSE_MAX_BYTES": ("tts_response_max_bytes", int),
            "VESNA_TTS_ENGINE_COMMAND": ("tts_engine_command", str),
            "VESNA_TTS_ENGINE_TIMEOUT": ("tts_engine_timeout", float),
            "VESNA_WORKER_POLL_SECONDS": ("worker_poll_seconds", float),
            "VESNA_WORKER_LEASE_SECONDS": ("worker_lease_seconds", float),
            "VESNA_VOICE_ID": ("voice_id", str),
            "VESNA_FFMPEG": ("ffmpeg_command", str),
            "VESNA_FFPROBE": ("ffprobe_command", str),
        }
        for environment_name, (name, converter) in scalar_names.items():
            if environment_name in os.environ:
                values[name] = converter(os.environ[environment_name])
        return cls(**values)

    def for_tts(self) -> "Settings":
        """Validate the configured engine command without invoking a shell."""
        if not shlex.split(self.tts_engine_command):
            raise ValueError("VESNA_TTS_ENGINE_COMMAND is required for the TTS process")
        return self


__all__ = ["Settings", "validate_loopback_url"]
