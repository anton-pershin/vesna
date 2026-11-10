"""FFmpeg audio assembly, FFprobe verification, and atomic version publication."""

from __future__ import annotations

from dataclasses import dataclass
import json
import math
import os
from pathlib import Path
import shlex
import subprocess
from typing import Any

from .artifacts import ArtifactError, ArtifactStore


class AssemblyError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class AssemblyResult:
    version: str
    root_path: str
    manifest_path: str
    text_sha256: str
    audio_sha256: str
    timings_sha256: str
    duration: float
    paragraph_count: int


class AudioAssembler:
    def __init__(
        self,
        store: ArtifactStore,
        *,
        ffmpeg_command: str = "ffmpeg",
        ffprobe_command: str = "ffprobe",
        subprocess_timeout: float = 120.0,
    ) -> None:
        self.store = store
        self.ffmpeg = shlex.split(ffmpeg_command)
        self.ffprobe = shlex.split(ffprobe_command)
        if not self.ffmpeg or not self.ffprobe:
            raise ValueError("FFmpeg and FFprobe commands must not be empty")
        self.subprocess_timeout = subprocess_timeout

    def _run(self, argv: list[str]) -> subprocess.CompletedProcess[bytes]:
        try:
            return subprocess.run(
                argv,
                stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                timeout=self.subprocess_timeout,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as error:
            raise AssemblyError("Audio processing command failed.") from error

    def probe(self, path: Path) -> tuple[float, str]:
        result = self._run(
            self.ffprobe
            + [
                "-v",
                "error",
                "-show_entries",
                "format=duration:stream=codec_name",
                "-of",
                "json",
                str(path),
            ]
        )
        if result.returncode != 0 or len(result.stdout) > 1_000_000:
            raise AssemblyError("Audio duration inspection failed.")
        try:
            payload = json.loads(result.stdout)
            duration = float(payload["format"]["duration"])
            codec = payload["streams"][0]["codec_name"]
        except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise AssemblyError("Audio duration inspection returned invalid metadata.") from error
        if not math.isfinite(duration) or duration <= 0 or duration > 24 * 60 * 60:
            raise AssemblyError("Audio duration is invalid.")
        return duration, codec

    def assemble(
        self,
        *,
        item_id: str,
        version: str,
        voice_id: str,
        paragraphs: list[dict[str, str]],
        segment_paths: list[str],
    ) -> AssemblyResult:
        if not paragraphs or len(paragraphs) != len(segment_paths):
            raise AssemblyError("Audio segments do not match listening paragraphs.")
        final_root = f"versions/{version}"
        if self.store.path(final_root).exists():
            return self.verify(final_root, item_id=item_id, version=version, voice_id=voice_id)

        staging_root = f"staging/{version}"
        self.store.remove_tree(staging_root)
        staging = self.store.path(staging_root)
        staging.mkdir(parents=True, mode=0o700)
        encoded_dir = self.store.path(f"work/{version}/encoded")
        encoded_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        encoded_paths: list[Path] = []
        durations: list[float] = []
        try:
            for index, (paragraph, source_path) in enumerate(zip(paragraphs, segment_paths, strict=True)):
                if paragraph.get("id") != f"p{index}" or not paragraph.get("text"):
                    raise AssemblyError("Listening paragraph identifiers are invalid.")
                source = self.store.path(source_path)
                if not source.is_file() or source.stat().st_size == 0:
                    raise AssemblyError("A generated speech segment is missing.")
                encoded = encoded_dir / f"p{index}.mp3"
                result = self._run(
                    self.ffmpeg
                    + [
                        "-nostdin",
                        "-y",
                        "-i",
                        str(source),
                        "-vn",
                        "-ac",
                        "1",
                        "-ar",
                        "24000",
                        "-codec:a",
                        "libmp3lame",
                        "-b:a",
                        "64k",
                        str(encoded),
                    ]
                )
                if result.returncode != 0 or not encoded.is_file() or encoded.stat().st_size == 0:
                    raise AssemblyError("A speech segment could not be encoded.")
                duration, codec = self.probe(encoded)
                if codec != "mp3":
                    raise AssemblyError("A speech segment has an unexpected encoding.")
                durations.append(duration)
                encoded_paths.append(encoded)

            concat_file = staging / "segments.concat"
            concat_file.write_text(
                "".join(f"file '{str(path).replace(chr(39), chr(39) + chr(92) + chr(39) + chr(39))}'\n" for path in encoded_paths),
                encoding="utf-8",
            )
            audio_path = staging / "audio.mp3"
            result = self._run(
                self.ffmpeg
                + [
                    "-nostdin",
                    "-y",
                    "-f",
                    "concat",
                    "-safe",
                    "0",
                    "-i",
                    str(concat_file),
                    "-codec:a",
                    "copy",
                    str(audio_path),
                ]
            )
            if result.returncode != 0 or not audio_path.is_file() or audio_path.stat().st_size == 0:
                raise AssemblyError("Complete audio could not be assembled.")
            final_duration, codec = self.probe(audio_path)
            if codec != "mp3":
                raise AssemblyError("Complete audio is not MP3.")

            cumulative = 0.0
            timings = []
            for index, duration in enumerate(durations):
                start = cumulative
                cumulative += duration
                timings.append(
                    {
                        "id": f"p{index}",
                        "start": round(start, 6),
                        "end": round(cumulative, 6),
                    }
                )
            tolerance = max(0.25, len(durations) * 0.1)
            if abs(cumulative - final_duration) > tolerance:
                raise AssemblyError("Complete audio duration does not match its segments.")
            timings[-1]["end"] = round(final_duration, 6)
            text_document = {"version": version, "paragraphs": paragraphs}
            timings_document = {"version": version, "timings": timings}
            self.store.write_json(f"{staging_root}/text.json", text_document)
            self.store.write_json(f"{staging_root}/timings.json", timings_document)
            concat_file.unlink(missing_ok=True)
            text_hash = self.store.sha256(f"{staging_root}/text.json")
            audio_hash = self.store.sha256(f"{staging_root}/audio.mp3")
            timings_hash = self.store.sha256(f"{staging_root}/timings.json")
            manifest = {
                "format": 1,
                "item_id": item_id,
                "version": version,
                "voice_id": voice_id,
                "paragraph_count": len(paragraphs),
                "duration": round(final_duration, 6),
                "text_sha256": text_hash,
                "audio_sha256": audio_hash,
                "timings_sha256": timings_hash,
                "paragraphs": [
                    {"id": paragraph["id"], "text_sha256": _text_hash(paragraph["text"])}
                    for paragraph in paragraphs
                ],
            }
            self.store.write_json(f"{staging_root}/manifest.json", manifest)
            verified = self.verify(
                staging_root, item_id=item_id, version=version, voice_id=voice_id
            )
            os.replace(staging, self.store.path(final_root))
            return AssemblyResult(
                version=version,
                root_path=final_root,
                manifest_path=f"{final_root}/manifest.json",
                text_sha256=verified.text_sha256,
                audio_sha256=verified.audio_sha256,
                timings_sha256=verified.timings_sha256,
                duration=verified.duration,
                paragraph_count=verified.paragraph_count,
            )
        except (OSError, ArtifactError) as error:
            # Staging is never API-visible. A later known-failure retry can rebuild it.
            raise AssemblyError("Audio artifacts could not be stored.") from error

    def verify(
        self,
        root_path: str,
        *,
        item_id: str | None = None,
        version: str | None = None,
        voice_id: str | None = None,
    ) -> AssemblyResult:
        try:
            manifest = self.store.read_json(f"{root_path}/manifest.json")
            if not isinstance(manifest, dict) or manifest.get("format") != 1:
                raise AssemblyError("Version manifest is invalid.")
            actual_version = manifest["version"]
            if version is not None and actual_version != version:
                raise AssemblyError("Version identifiers do not match.")
            if item_id is not None and manifest.get("item_id") != item_id:
                raise AssemblyError("Version item identifiers do not match.")
            if voice_id is not None and manifest.get("voice_id") != voice_id:
                raise AssemblyError("Version voice identifiers do not match.")
            text = self.store.read_json(f"{root_path}/text.json")
            timings = self.store.read_json(f"{root_path}/timings.json")
            if text.get("version") != actual_version or timings.get("version") != actual_version:
                raise AssemblyError("Version artifacts identify different versions.")
            paragraphs = text["paragraphs"]
            positions = timings["timings"]
            if not paragraphs or len(paragraphs) != len(positions):
                raise AssemblyError("Version text and timings do not match.")
            if manifest.get("paragraph_count") != len(paragraphs):
                raise AssemblyError("Version paragraph count does not match.")
            for index, (paragraph, position) in enumerate(zip(paragraphs, positions, strict=True)):
                if paragraph["id"] != f"p{index}" or position["id"] != paragraph["id"]:
                    raise AssemblyError("Version paragraph identifiers do not match.")
                if manifest["paragraphs"][index] != {
                    "id": paragraph["id"],
                    "text_sha256": _text_hash(paragraph["text"]),
                }:
                    raise AssemblyError("Version text hash does not match.")
            hashes = {
                "text_sha256": self.store.sha256(f"{root_path}/text.json"),
                "audio_sha256": self.store.sha256(f"{root_path}/audio.mp3"),
                "timings_sha256": self.store.sha256(f"{root_path}/timings.json"),
            }
            for key, digest in hashes.items():
                if manifest.get(key) != digest:
                    raise AssemblyError("Version artifact hash does not match.")
            duration, codec = self.probe(self.store.path(f"{root_path}/audio.mp3"))
            if codec != "mp3" or abs(duration - float(manifest["duration"])) > 0.1:
                raise AssemblyError("Final encoded audio duration does not match the manifest.")
            previous_end = 0.0
            for index, position in enumerate(positions):
                start = float(position["start"])
                end = float(position["end"])
                if (
                    not math.isfinite(start)
                    or not math.isfinite(end)
                    or abs(start - previous_end) > 0.002
                    or end <= start
                    or end > duration + 0.1
                ):
                    raise AssemblyError("Paragraph timings are inconsistent with final audio.")
                previous_end = end
            if abs(previous_end - duration) > 0.1:
                raise AssemblyError("Paragraph timings do not cover final audio.")
            return AssemblyResult(
                version=actual_version,
                root_path=root_path,
                manifest_path=f"{root_path}/manifest.json",
                text_sha256=hashes["text_sha256"],
                audio_sha256=hashes["audio_sha256"],
                timings_sha256=hashes["timings_sha256"],
                duration=duration,
                paragraph_count=len(paragraphs),
            )
        except AssemblyError:
            raise
        except (ArtifactError, KeyError, IndexError, TypeError, ValueError) as error:
            raise AssemblyError("Version artifacts are incomplete or inconsistent.") from error


def _text_hash(text: str) -> str:
    import hashlib

    return hashlib.sha256(text.encode("utf-8")).hexdigest()


__all__ = ["AssemblyError", "AssemblyResult", "AudioAssembler"]
