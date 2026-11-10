"""Private, identifier-based filesystem artifacts with atomic writes."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile
from typing import Any


class ArtifactError(RuntimeError):
    pass


class ArtifactStore:
    def __init__(self, root: str | Path) -> None:
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            self.root.chmod(0o700)
        except OSError:
            pass
        for directory in ("sources", "work", "staging", "versions"):
            (self.root / directory).mkdir(mode=0o700, exist_ok=True)

    def path(self, relative: str) -> Path:
        pure = PurePosixPath(relative)
        if pure.is_absolute() or not relative or any(part in {"", ".", ".."} for part in pure.parts):
            raise ArtifactError("invalid artifact identifier")
        candidate = self.root.joinpath(*pure.parts)
        resolved = candidate.resolve()
        if resolved != self.root and self.root not in resolved.parents:
            raise ArtifactError("artifact path escapes private storage")
        return candidate

    def relative(self, path: str | Path) -> str:
        candidate = Path(path).resolve()
        try:
            return candidate.relative_to(self.root).as_posix()
        except ValueError as error:
            raise ArtifactError("artifact path escapes private storage") from error

    def write_bytes(self, relative: str, data: bytes) -> Path:
        destination = self.path(relative)
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor, temporary_name = tempfile.mkstemp(prefix=".write-", dir=destination.parent)
        temporary = Path(temporary_name)
        try:
            with os.fdopen(descriptor, "wb") as output:
                output.write(data)
                output.flush()
                os.fsync(output.fileno())
            temporary.chmod(0o600)
            os.replace(temporary, destination)
            return destination
        finally:
            temporary.unlink(missing_ok=True)

    def write_json(self, relative: str, value: Any) -> Path:
        data = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        return self.write_bytes(relative, data.encode("utf-8") + b"\n")

    def read_bytes(self, relative: str) -> bytes:
        try:
            return self.path(relative).read_bytes()
        except (OSError, ArtifactError) as error:
            raise ArtifactError("artifact is unavailable") from error

    def read_json(self, relative: str) -> Any:
        try:
            return json.loads(self.read_bytes(relative))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ArtifactError("artifact is invalid") from error

    def remove(self, relative: str) -> None:
        try:
            self.path(relative).unlink(missing_ok=True)
        except OSError:
            pass

    def remove_tree(self, relative: str) -> None:
        path = self.path(relative)
        if len(PurePosixPath(relative).parts) < 2:
            raise ArtifactError("refusing to remove an artifact storage category")
        shutil.rmtree(path, ignore_errors=True)

    def sha256(self, relative: str) -> str:
        digest = hashlib.sha256()
        try:
            with self.path(relative).open("rb") as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    digest.update(chunk)
        except OSError as error:
            raise ArtifactError("artifact is unavailable") from error
        return digest.hexdigest()


def bytes_sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


__all__ = ["ArtifactError", "ArtifactStore", "bytes_sha256"]
