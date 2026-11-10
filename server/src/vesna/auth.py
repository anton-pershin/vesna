"""Stdlib scrypt password verification and opaque session-token helpers."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets

_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SALT_BYTES = 16
_HASH_BYTES = 32
_MAX_PASSWORD_BYTES = 1024


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _b64decode(value: str) -> bytes:
    return base64.b64decode(value + "=" * (-len(value) % 4), altchars=b"-_", validate=True)


def hash_password(password: str, *, salt: bytes | None = None) -> str:
    """Return a versioned scrypt hash; callers supply passwords interactively."""
    if not isinstance(password, str) or not password:
        raise ValueError("password must be non-empty")
    encoded = password.encode("utf-8")
    if len(encoded) > _MAX_PASSWORD_BYTES:
        raise ValueError("password is too long")
    salt = secrets.token_bytes(_SALT_BYTES) if salt is None else salt
    if len(salt) < 16:
        raise ValueError("salt must contain at least 16 bytes")
    digest = hashlib.scrypt(
        encoded,
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_HASH_BYTES,
        maxmem=64 * 1024 * 1024,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, encoded_hash: str) -> bool:
    """Verify a hash without propagating parser details or using equality on digests."""
    try:
        if not isinstance(password, str) or len(password.encode("utf-8")) > _MAX_PASSWORD_BYTES:
            return False
        algorithm, n_text, r_text, p_text, salt_text, digest_text = encoded_hash.split("$")
        if algorithm != "scrypt":
            return False
        n, r, p = int(n_text), int(r_text), int(p_text)
        # Bound externally supplied cost parameters before allocating memory.
        if n != _SCRYPT_N or r != _SCRYPT_R or p != _SCRYPT_P:
            return False
        salt = _b64decode(salt_text)
        expected = _b64decode(digest_text)
        if len(salt) < 16 or len(expected) != _HASH_BYTES:
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=n,
            r=r,
            p=p,
            dklen=len(expected),
            maxmem=64 * 1024 * 1024,
        )
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError, UnicodeError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(32)


def session_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("ascii")).hexdigest()


__all__ = ["hash_password", "new_session_token", "session_token_hash", "verify_password"]
