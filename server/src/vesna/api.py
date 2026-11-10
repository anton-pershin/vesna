"""Authenticated same-origin FastAPI application and private artifact delivery."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePath
import re
from typing import Any, AsyncIterator
from urllib.parse import unquote_to_bytes
from uuid import uuid4

from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from .artifacts import ArtifactError, ArtifactStore
from .auth import new_session_token, session_token_hash, verify_password
from .config import Settings
from .db import Database, OWNER, summary
from .text import (
    InputValidationError,
    decode_markdown,
    validate_article_url,
    validate_filename,
)

COOKIE_NAME = "vesna_session"


class SignInRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(max_length=1024)


class ArticleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2048)


class RequestLimits:
    def __init__(self, app: Any, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope["method"] not in {"POST", "PUT", "PATCH"}:
            await self.app(scope, receive, send)
            return
        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length:
            try:
                if int(content_length) > self.max_bytes:
                    await self._too_large(send)
                    return
            except ValueError:
                await self._too_large(send)
                return
        body = bytearray()
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            body.extend(message.get("body", b""))
            if len(body) > self.max_bytes:
                await self._too_large(send)
                return
            if not message.get("more_body", False):
                break
        content_type = headers.get(b"content-type", b"")
        if content_type.startswith(b"multipart/form-data"):
            raw_filenames = re.findall(rb'filename="([^"]*)"', bytes(body))
            unsafe_filename = any(
                any(byte < 32 or byte == 127 for byte in unquote_to_bytes(raw_filename))
                for raw_filename in raw_filenames
            )
            if b"\x00" in body or unsafe_filename:
                response = JSONResponse(
                    status_code=422,
                    content={"detail": "Multipart upload contains unsafe control bytes."},
                )
                await response(scope, _empty_receive, send)
                return
        delivered = False

        async def replay() -> dict[str, Any]:
            nonlocal delivered
            if not delivered:
                delivered = True
                return {"type": "http.request", "body": bytes(body), "more_body": False}
            return {"type": "http.request", "body": b"", "more_body": False}

        await self.app(scope, replay, send)

    async def _too_large(self, send) -> None:
        response = JSONResponse(status_code=413, content={"detail": "Request body is too large."})
        await response({"type": "http", "method": "POST", "headers": []}, _empty_receive, send)


async def _empty_receive() -> dict[str, Any]:
    return {"type": "http.request", "body": b"", "more_body": False}


class MutationOriginCheck:
    def __init__(self, app: Any, public_origin: str) -> None:
        self.app = app
        self.public_origin = public_origin

    async def __call__(self, scope, receive, send) -> None:
        if (
            scope["type"] == "http"
            and scope["path"].startswith("/api/")
            and scope["method"] in {"POST", "PUT", "PATCH", "DELETE"}
        ):
            headers = dict(scope.get("headers", []))
            origin = headers.get(b"origin", b"").decode("latin-1")
            fetch_site = headers.get(b"sec-fetch-site", b"").decode("latin-1")
            if origin != self.public_origin or fetch_site in {"cross-site", "same-site"}:
                response = JSONResponse(
                    status_code=403, content={"detail": "Cross-site mutation is not allowed."}
                )
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def create_app(
    settings: Settings | None = None,
    *,
    database: Database | None = None,
    store: ArtifactStore | None = None,
) -> FastAPI:
    settings = settings or Settings.from_env(require_auth=True)
    if not settings.password_hash:
        raise ValueError("The API requires an externally supplied scrypt password hash")
    database = database or Database(settings.database_path)
    store = store or ArtifactStore(settings.artifact_root)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    app.router.redirect_slashes = False
    app.state.settings = settings
    app.state.database = database
    app.state.store = store
    app.add_middleware(RequestLimits, max_bytes=settings.request_max_bytes)
    app.add_middleware(MutationOriginCheck, public_origin=settings.public_origin)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        if request.url.path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
            response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Content-Type-Options"] = "nosniff"
        return response

    @app.exception_handler(RequestValidationError)
    async def invalid_request(request: Request, error: RequestValidationError):
        # Do not reflect passwords, uploaded content, or parser internals in errors.
        return JSONResponse(status_code=422, content={"detail": "Invalid request."})

    def owner(request: Request) -> str:
        token = request.cookies.get(COOKIE_NAME)
        if not token or len(token) > 128:
            raise HTTPException(status_code=401, detail="Authentication required.")
        try:
            token_hash = session_token_hash(token)
        except (UnicodeError, ValueError):
            raise HTTPException(status_code=401, detail="Authentication required.") from None
        authenticated_owner = database.session_owner(token_hash)
        if authenticated_owner is None:
            raise HTTPException(status_code=401, detail="Authentication required.")
        return authenticated_owner

    def item_or_404(item_id: str, authenticated_owner: str) -> dict[str, Any]:
        item = database.get_item(item_id, authenticated_owner)
        if item is None:
            raise HTTPException(status_code=404, detail="Item not found.")
        return item

    @app.post("/api/auth/sign-in", status_code=204)
    def sign_in(payload: SignInRequest) -> Response:
        if not verify_password(payload.password, settings.password_hash):
            raise HTTPException(status_code=401, detail="Sign-in failed.")
        token = new_session_token()
        database.create_session(session_token_hash(token), settings.session_ttl_seconds)
        response = Response(status_code=204)
        response.set_cookie(
            COOKIE_NAME,
            token,
            max_age=settings.session_ttl_seconds,
            expires=settings.session_ttl_seconds,
            path="/",
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return response

    @app.post("/api/auth/sign-out", status_code=204)
    def sign_out(request: Request, authenticated_owner: str = Depends(owner)) -> Response:
        token = request.cookies[COOKIE_NAME]
        database.delete_session(session_token_hash(token))
        response = Response(status_code=204)
        response.delete_cookie(
            COOKIE_NAME,
            path="/",
            secure=True,
            httponly=True,
            samesite="strict",
        )
        return response

    @app.get("/api/auth/session")
    def session(authenticated_owner: str = Depends(owner)) -> dict[str, bool]:
        return {"authenticated": True}

    @app.get("/api/items")
    def items(authenticated_owner: str = Depends(owner)) -> dict[str, Any]:
        return {"items": database.list_items(authenticated_owner)}

    @app.post("/api/items/article", status_code=202)
    def submit_article(
        payload: ArticleRequest, authenticated_owner: str = Depends(owner)
    ) -> dict[str, Any]:
        try:
            url = validate_article_url(payload.url)
        except InputValidationError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        return database.create_item(kind="article", source_url=url)

    @app.post("/api/items/markdown", status_code=202)
    async def submit_markdown(
        file: UploadFile = File(...), authenticated_owner: str = Depends(owner)
    ) -> dict[str, Any]:
        try:
            filename = validate_filename(file.filename)
            data = bytearray()
            while chunk := await file.read(min(65536, settings.upload_max_bytes + 1 - len(data))):
                data.extend(chunk)
                if len(data) > settings.upload_max_bytes:
                    raise InputValidationError("Markdown file exceeds the upload size limit.")
                if len(data) > settings.upload_max_bytes:
                    break
            text = decode_markdown(bytes(data))
        except InputValidationError as error:
            raise HTTPException(status_code=422, detail=str(error)) from None
        finally:
            await file.close()
        original_path = f"sources/{uuid4()}/original{PurePath(filename).suffix.casefold()}"
        store.write_bytes(original_path, bytes(data))
        try:
            return database.create_item(
                kind="markdown",
                filename=filename,
                original_path=original_path,
                title=PurePath(filename).stem,
            )
        except Exception:
            store.remove(original_path)
            raise

    @app.get("/api/items/{item_id}")
    def item_detail(
        item_id: str, authenticated_owner: str = Depends(owner)
    ) -> dict[str, Any]:
        item = item_or_404(item_id, authenticated_owner)
        paragraphs: list[dict[str, str]] = []
        try:
            if item["published_version"]:
                document = version_document(
                    database,
                    store,
                    item,
                    item["published_version"],
                    "text.json",
                    authenticated_owner,
                )
                paragraphs = document["paragraphs"]
            else:
                job = database.get_item_job(item_id, authenticated_owner)
                stage = database.get_stage(job["id"], "source") if job else None
                if stage:
                    source = store.read_json(stage["artifact_path"])
                    if source["item_id"] == item_id and source["version"] == job["candidate_version"]:
                        paragraphs = source["paragraphs"]
        except (ArtifactError, KeyError, TypeError, ValueError, json.JSONDecodeError):
            raise HTTPException(status_code=409, detail="Prepared source is unavailable.") from None
        source_available = False
        if item["kind"] == "markdown" and item["original_path"]:
            try:
                source_available = store.path(item["original_path"]).is_file()
            except ArtifactError:
                source_available = False
        return {
            "item": summary(item),
            "paragraphs": paragraphs,
            "source_available": source_available,
        }

    @app.post("/api/items/{item_id}/retry", status_code=202)
    def retry(item_id: str, authenticated_owner: str = Depends(owner)) -> dict[str, Any]:
        outcome, item = database.retry(item_id, authenticated_owner)
        if outcome == "missing":
            raise HTTPException(status_code=404, detail="Item not found.")
        if outcome != "ok":
            raise HTTPException(status_code=409, detail="Only failed items can be retried.")
        return item

    @app.get("/api/items/{item_id}/source")
    def original_source(item_id: str, authenticated_owner: str = Depends(owner)) -> Response:
        item = item_or_404(item_id, authenticated_owner)
        if item["kind"] != "markdown" or not item["original_path"]:
            raise HTTPException(status_code=404, detail="Original source is unavailable.")
        try:
            content = store.read_bytes(item["original_path"])
        except ArtifactError:
            raise HTTPException(status_code=404, detail="Original source is unavailable.") from None
        return Response(content=content, media_type="text/plain; charset=utf-8")

    @app.get("/api/items/{item_id}/versions/{version}/text")
    def prepared_text(
        item_id: str, version: str, authenticated_owner: str = Depends(owner)
    ) -> dict[str, Any]:
        item = item_or_404(item_id, authenticated_owner)
        return version_document(database, store, item, version, "text.json", authenticated_owner)

    @app.get("/api/items/{item_id}/versions/{version}/timings")
    def prepared_timings(
        item_id: str, version: str, authenticated_owner: str = Depends(owner)
    ) -> dict[str, Any]:
        item = item_or_404(item_id, authenticated_owner)
        return version_document(database, store, item, version, "timings.json", authenticated_owner)

    @app.api_route("/api/items/{item_id}/versions/{version}/audio", methods=["GET", "HEAD"])
    def prepared_audio(
        item_id: str, version: str, request: Request, authenticated_owner: str = Depends(owner)
    ) -> Response:
        item = item_or_404(item_id, authenticated_owner)
        record = ready_version(database, item, version, authenticated_owner)
        try:
            if record["root_path"] != f"versions/{version}":
                raise ArtifactError("invalid version root")
            path = store.path(f"{record['root_path']}/audio.mp3")
            size = path.stat().st_size
            if size <= 0:
                raise OSError("empty audio")
        except (ArtifactError, OSError):
            raise HTTPException(status_code=409, detail="Prepared audio is unavailable.") from None
        start, end, status = parse_range(request.headers.get("range"), size)
        if status == 416:
            return Response(
                status_code=416,
                headers={
                    "Accept-Ranges": "bytes",
                    "Content-Range": f"bytes */{size}",
                    "Content-Length": "0",
                },
            )
        length = size if start is None else end - start + 1
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Cache-Control": "private, no-store",
        }
        if start is not None:
            headers["Content-Range"] = f"bytes {start}-{end}/{size}"
        if request.method == "HEAD":
            return Response(status_code=status, headers=headers, media_type="audio/mpeg")
        return StreamingResponse(
            file_range(path, 0 if start is None else start, length),
            status_code=status,
            headers=headers,
            media_type="audio/mpeg",
        )

    static_dir = settings.static_dir
    if static_dir is None:
        candidate = Path(__file__).resolve().parents[3] / "public"
        static_dir = candidate if candidate.is_dir() else None
    if static_dir is not None and static_dir.is_dir():
        public_root = static_dir.resolve()
        private_paths = (store.root, settings.database_path.resolve())
        if any(path == public_root or public_root in path.parents for path in private_paths):
            raise ValueError("Database and artifacts must be outside the static directory")
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="public")

    return app


def ready_version(
    database: Database, item: dict[str, Any], version: str, owner: str
) -> dict[str, Any]:
    record = database.get_ready_version(item["id"], version, owner)
    if record is None:
        raise HTTPException(status_code=404, detail="Prepared version not found.")
    return record


def version_document(
    database: Database,
    store: ArtifactStore,
    item: dict[str, Any],
    version: str,
    filename: str,
    owner: str,
) -> dict[str, Any]:
    record = ready_version(database, item, version, owner)
    try:
        if record["root_path"] != f"versions/{version}":
            raise ArtifactError("invalid version root")
        manifest = store.read_json(record["manifest_path"])
        if manifest["version"] != version or manifest["item_id"] != item["id"]:
            raise ArtifactError("version mismatch")
        relative = f"{record['root_path']}/{filename}"
        raw = store.read_bytes(relative)
        expected_key = "text_sha256" if filename == "text.json" else "timings_sha256"
        if hashlib.sha256(raw).hexdigest() != record[expected_key] or manifest[expected_key] != record[expected_key]:
            raise ArtifactError("artifact hash mismatch")
        document = json.loads(raw)
        if document["version"] != version:
            raise ArtifactError("artifact version mismatch")
        if filename == "text.json" and len(document["paragraphs"]) != record["paragraph_count"]:
            raise ArtifactError("paragraph count mismatch")
        return document
    except (ArtifactError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        raise HTTPException(status_code=409, detail="Prepared version is unavailable.") from None


def parse_range(header: str | None, size: int) -> tuple[int | None, int, int]:
    """Return (start, end, status); malformed ranges are ignored per RFC 9110."""
    if header is None:
        return None, size - 1, 200
    match = re.fullmatch(r"bytes=(\d*)-(\d*)", header.strip())
    if not match or (not match.group(1) and not match.group(2)):
        return None, size - 1, 200
    first, last = match.groups()
    if not first:
        suffix = int(last)
        if suffix == 0:
            return None, size - 1, 416
        start = max(0, size - suffix)
        return start, size - 1, 206
    start = int(first)
    if start >= size:
        return None, size - 1, 416
    if last:
        end = int(last)
        if end < start:
            return None, size - 1, 200
        end = min(end, size - 1)
    else:
        end = size - 1
    return start, end, 206


async def file_range(path: Path, start: int, length: int) -> AsyncIterator[bytes]:
    # StreamingResponse consumes this synchronous-work-free generator in the event loop;
    # each read is bounded and version files are immutable after publication.
    with path.open("rb") as source:
        source.seek(start)
        remaining = length
        while remaining:
            chunk = source.read(min(256 * 1024, remaining))
            if not chunk:
                raise OSError("Published audio changed while being read.")
            remaining -= len(chunk)
            yield chunk


__all__ = ["COOKIE_NAME", "create_app", "parse_range"]
