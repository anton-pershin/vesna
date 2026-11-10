"""Single durable preparation worker with reusable, input-bound saved stages."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import time
from typing import Any, Protocol
from urllib.parse import urlsplit
from uuid import uuid4

from comourat.enrichment.page_fetch import PageFetcher
from comourat.fetch import FetchPolicy

from .artifacts import ArtifactError, ArtifactStore, bytes_sha256
from .audio import AssemblyError, AudioAssembler
from .comourat_integration import ComouratAdapter
from .config import Settings
from .db import Database
from .text import (
    InputValidationError,
    decode_markdown,
    plain_paragraphs,
    validate_paragraphs,
)
from .tts import TtsClient, TtsError, validate_wav


class ArticleAdapter(Protocol):
    def fetch_article(self, url: str) -> Any: ...


class PreparationError(RuntimeError):
    pass


class _StaleClaim(RuntimeError):
    pass


def build_article_adapter(settings: Settings) -> ComouratAdapter:
    """Compose only the public article path; no unrelated clients or credentials."""
    tts_host = urlsplit(settings.tts_url).hostname
    policy = FetchPolicy(
        deny_hosts=[tts_host] if tts_host else [],
        connection_timeout=settings.article_connection_timeout,
        read_timeout=settings.article_read_timeout,
        overall_timeout=settings.article_overall_timeout,
        max_retries=0,
    )
    return ComouratAdapter(page_fetcher=PageFetcher(fetch_policy=policy))


class Worker:
    def __init__(
        self,
        settings: Settings,
        database: Database,
        store: ArtifactStore,
        *,
        article_adapter: ArticleAdapter | None = None,
        tts_client: Any | None = None,
        assembler: AudioAssembler | None = None,
    ) -> None:
        self.settings = settings
        self.database = database
        self.store = store
        self.article_adapter = article_adapter
        self.tts_client = tts_client or TtsClient(
            settings.tts_url,
            connect_timeout=settings.tts_connect_timeout,
            overall_timeout=settings.tts_overall_timeout,
            max_response_bytes=settings.tts_response_max_bytes,
        )
        self.assembler = assembler or AudioAssembler(
            store,
            ffmpeg_command=settings.ffmpeg_command,
            ffprobe_command=settings.ffprobe_command,
        )

    def run_once(self) -> bool:
        claim = f"worker-{uuid4()}"
        job = self.database.claim_job(claim, self.settings.worker_lease_seconds)
        if job is None:
            return False
        try:
            self._process(job, claim)
        except _StaleClaim:
            pass
        except PreparationError as error:
            self.database.fail_job(job["id"], claim, str(error))
        except Exception:
            self.database.fail_job(job["id"], claim, "Preparation failed; retry is available.")
        return True

    def run_forever(self) -> None:
        while True:
            if not self.run_once():
                time.sleep(self.settings.worker_poll_seconds)

    def _process(self, job: dict[str, Any], claim: str) -> None:
        try:
            source = self._source(job, claim)
        except _StaleClaim:
            raise
        except Exception as error:
            message = (
                "Article extraction failed; check the public URL and retry."
                if job["kind"] == "article"
                else "Markdown preparation failed; retry is available."
            )
            raise PreparationError(message) from error

        paragraphs = source["paragraphs"]
        segment_paths: list[str] = []
        for paragraph in paragraphs:
            if not self.database.renew_lease(
                job["id"], claim, self.settings.worker_lease_seconds
            ):
                raise _StaleClaim()
            try:
                segment_paths.append(self._speech(job, claim, source, paragraph))
            except _StaleClaim:
                raise
            except Exception as error:
                raise PreparationError("Speech generation failed; retry is available.") from error

        try:
            result = self.assembler.assemble(
                item_id=job["item_id"],
                version=job["candidate_version"],
                voice_id=self.settings.voice_id,
                paragraphs=paragraphs,
                segment_paths=segment_paths,
            )
        except AssemblyError as error:
            raise PreparationError("Audio assembly failed; retry is available.") from error
        published = self.database.publish_version(
            job_id=job["id"],
            worker_id=claim,
            version=result.version,
            root_path=result.root_path,
            manifest_path=result.manifest_path,
            text_sha256=result.text_sha256,
            audio_sha256=result.audio_sha256,
            timings_sha256=result.timings_sha256,
            duration=result.duration,
            paragraph_count=result.paragraph_count,
        )
        if not published:
            raise _StaleClaim()

    def _source(self, job: dict[str, Any], claim: str) -> dict[str, Any]:
        original: bytes | None = None
        if job["kind"] == "markdown":
            original = self.store.read_bytes(job["original_path"])
            source_input = bytes_sha256(b"markdown\0" + original)
        else:
            source_input = bytes_sha256(b"article\0" + job["source_url"].encode("utf-8"))
        expected_path = f"work/{job['candidate_version']}/source.json"
        try:
            stage = self.database.get_stage(job["id"], "source")
            if (
                stage
                and stage["input_hash"] == source_input
                and stage["artifact_path"] == expected_path
            ):
                source = self.store.read_json(expected_path)
                self._validate_source(source, job, source_input)
                return source
        except (ArtifactError, InputValidationError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            pass

        if job["kind"] == "markdown":
            text = decode_markdown(original or b"")
            title = Path(job["filename"]).stem
            retrieved_source_url = None
        else:
            adapter = self.article_adapter
            if adapter is None:
                adapter = build_article_adapter(self.settings)
            article = adapter.fetch_article(job["source_url"])
            title = article.title.strip()
            text = article.text
            retrieved_source_url = article.source_url
            if not title or not isinstance(text, str) or not text.strip():
                raise InputValidationError("Article extraction returned empty content.")
        paragraphs = plain_paragraphs(text)
        validate_paragraphs(
            paragraphs,
            max_paragraphs=self.settings.max_paragraphs,
            max_paragraph_chars=self.settings.max_paragraph_chars,
        )
        source = {
            "version": job["candidate_version"],
            "item_id": job["item_id"],
            "kind": job["kind"],
            "input_hash": source_input,
            "title": title,
            "source_url": job["source_url"],
            "retrieved_source_url": retrieved_source_url,
            "filename": job["filename"],
            "paragraphs": paragraphs,
        }
        self.store.write_json(expected_path, source)
        saved = self.database.save_source(
            job_id=job["id"],
            worker_id=claim,
            title=title,
            paragraph_count=len(paragraphs),
            input_hash=source_input,
            artifact_path=expected_path,
            metadata={"version": job["candidate_version"], "paragraph_count": len(paragraphs)},
        )
        if not saved:
            raise _StaleClaim()
        return source

    def _validate_source(self, source: Any, job: dict[str, Any], source_input: str) -> None:
        if not isinstance(source, dict):
            raise InputValidationError("Saved source is invalid.")
        if (
            source.get("version") != job["candidate_version"]
            or source.get("item_id") != job["item_id"]
            or source.get("kind") != job["kind"]
            or source.get("input_hash") != source_input
            or source.get("source_url") != job["source_url"]
            or source.get("filename") != job["filename"]
        ):
            raise InputValidationError("Saved source inputs do not match.")
        paragraphs = source.get("paragraphs")
        if not isinstance(paragraphs, list):
            raise InputValidationError("Saved source paragraphs are invalid.")
        validate_paragraphs(
            paragraphs,
            max_paragraphs=self.settings.max_paragraphs,
            max_paragraph_chars=self.settings.max_paragraph_chars,
        )

    def _speech(
        self,
        job: dict[str, Any],
        claim: str,
        source: dict[str, Any],
        paragraph: dict[str, str],
    ) -> str:
        stage_name = f"speech:{paragraph['id']}"
        relative = f"work/{job['candidate_version']}/segments/{paragraph['id']}.wav"
        text_hash = bytes_sha256(paragraph["text"].encode("utf-8"))
        input_hash = bytes_sha256(
            self.settings.voice_id.encode("utf-8") + b"\0" + paragraph["text"].encode("utf-8")
        )
        try:
            stage = self.database.get_stage(job["id"], stage_name)
            if (
                stage
                and stage["input_hash"] == input_hash
                and stage["artifact_path"] == relative
                and stage["metadata"].get("version") == job["candidate_version"]
                and stage["metadata"].get("voice_id") == self.settings.voice_id
                and stage["metadata"].get("text_sha256") == text_hash
            ):
                audio = self.store.read_bytes(relative)
                validate_wav(audio)
                if bytes_sha256(audio) == stage["metadata"].get("audio_sha256"):
                    return relative
        except (ArtifactError, TtsError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            pass
        client = self.tts_client
        if client is None:
            client = TtsClient(
                self.settings.tts_url,
                connect_timeout=self.settings.tts_connect_timeout,
                overall_timeout=self.settings.tts_overall_timeout,
                max_response_bytes=self.settings.tts_response_max_bytes,
            )
        audio = client.synthesize(paragraph["text"])
        if len(audio) > self.settings.tts_response_max_bytes:
            raise TtsError("Speech response exceeded the size limit.")
        validate_wav(audio)
        self.store.write_bytes(relative, audio)
        saved = self.database.save_stage(
            job_id=job["id"],
            worker_id=claim,
            stage=stage_name,
            input_hash=input_hash,
            artifact_path=relative,
            metadata={
                "version": job["candidate_version"],
                "voice_id": self.settings.voice_id,
                "text_sha256": text_hash,
                "audio_sha256": bytes_sha256(audio),
            },
        )
        if not saved:
            raise _StaleClaim()
        return relative


__all__ = ["ArticleAdapter", "PreparationError", "Worker", "build_article_adapter"]
