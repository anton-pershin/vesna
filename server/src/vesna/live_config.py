"""Shared live-check policy and evidence-sanitization helpers."""

from urllib.parse import urlsplit, urlunsplit

from comourat.fetch import FetchPolicy


def make_live_fetch_policy(tts_host: str) -> FetchPolicy:
    """Use one explicit TTS deny rule for every live integration client."""
    if not isinstance(tts_host, str) or not tts_host.strip():
        raise ValueError("TTS host must be non-empty")
    return FetchPolicy(
        deny_hosts=[tts_host.strip()],
        overall_timeout=60,
        connection_timeout=10,
        read_timeout=30,
    )


def sanitized_source_url(url: str) -> str:
    """Remove credentials, query parameters, and fragments from a source URL."""
    parts = urlsplit(url)
    if parts.username is not None or parts.password is not None:
        raise ValueError("source URL must not contain credentials")
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ValueError("source URL must be an HTTP or HTTPS URL")
    host = parts.hostname
    if ":" in host and not host.startswith("["):
        host = f"[{host}]"
    if parts.port is not None:
        host = f"{host}:{parts.port}"
    return urlunsplit((parts.scheme, host, parts.path, "", ""))


__all__ = ["make_live_fetch_policy", "sanitized_source_url"]
