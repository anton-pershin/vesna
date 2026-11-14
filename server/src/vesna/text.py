"""Untrusted input validation and non-retrieving plain-text paragraph parsing."""

from __future__ import annotations

from html.parser import HTMLParser
import ipaddress
from pathlib import PurePath
import re
from urllib.parse import urlsplit, urlunsplit


class InputValidationError(ValueError):
    pass


def validate_article_url(value: str) -> str:
    if not isinstance(value, str) or not value or len(value) > 2048:
        raise InputValidationError("Enter a valid public article URL.")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise InputValidationError("Enter a valid public article URL.")
    try:
        parts = urlsplit(value)
        port = parts.port
    except ValueError as error:
        raise InputValidationError("Enter a valid public article URL.") from error
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
    ):
        raise InputValidationError("Enter a valid public HTTP or HTTPS article URL.")
    hostname = parts.hostname.rstrip(".").casefold()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local")):
        raise InputValidationError("The article destination is not public.")
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        address = None
    if address is not None and not address.is_global:
        raise InputValidationError("The article destination is not public.")
    # Normalize only the scheme and hostname; extraction still receives the complete URL.
    host = parts.hostname.casefold()
    if ":" in host:
        host = f"[{host}]"
    if port is not None:
        host = f"{host}:{port}"
    return urlunsplit((parts.scheme, host, parts.path or "/", parts.query, ""))


def validate_filename(filename: str | None) -> str:
    if not filename or filename in {".", ".."} or len(filename.encode("utf-8")) > 255:
        raise InputValidationError("Choose a valid Markdown file.")
    if (
        "/" in filename
        or "\\" in filename
        or any(ord(character) < 32 or ord(character) == 127 for character in filename)
    ):
        raise InputValidationError("The uploaded filename is unsafe.")
    if PurePath(filename).suffix.casefold() not in {".md", ".markdown"}:
        raise InputValidationError("Only .md and .markdown files are supported.")
    return filename


def decode_markdown(data: bytes) -> str:
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError as error:
        raise InputValidationError("Markdown must be valid UTF-8.") from error
    if not text.strip():
        raise InputValidationError("Markdown content must not be empty.")
    if "\x00" in text:
        raise InputValidationError("Markdown contains an unsupported control character.")
    return text


class _InertHTMLText(HTMLParser):
    """Discard tags and retain text without loading images, links, or subresources."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() in {"br", "p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() in {"p", "div", "li", "tr", "h1", "h2", "h3"}:
            self.parts.append(" ")


def _plain_block(block: str) -> str:
    lines = []
    in_fence = False
    for line in block.splitlines():
        if re.match(r"^\s*(```|~~~)", line):
            in_fence = not in_fence
            continue
        if not in_fence:
            line = re.sub(r"^\s{0,3}#{1,6}\s+", "", line)
            line = re.sub(r"^\s*(?:>|[-+*]|\d+[.)])\s+", "", line)
        lines.append(line)
    value = "\n".join(lines)
    # Link targets remain unvisited; only human-readable labels become listening text.
    value = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", value)
    value = re.sub(r"\[([^\]]+)\]\[[^\]]*\]", r"\1", value)
    parser = _InertHTMLText()
    parser.feed(value)
    parser.close()
    value = "".join(parser.parts)
    value = value.replace("**", "").replace("__", "").replace("~~", "")
    value = value.replace("`", "")
    # Keep source line boundaries while normalizing whitespace within each line.
    return "\n".join(" ".join(line.split()) for line in value.split("\n"))


def plain_paragraphs(text: str) -> list[dict[str, str]]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n\s*\n", normalized)
    paragraphs = []
    for block in blocks:
        for plain in _plain_block(block).split("\n"):
            if plain:
                paragraphs.append({"id": f"p{len(paragraphs)}", "text": plain})
    return paragraphs


def validate_paragraphs(
    paragraphs: list[dict[str, str]], *, max_paragraphs: int, max_paragraph_chars: int
) -> None:
    if not paragraphs or len(paragraphs) > max_paragraphs:
        raise InputValidationError("The content does not contain an acceptable number of paragraphs.")
    for index, paragraph in enumerate(paragraphs):
        if (
            paragraph.get("id") != f"p{index}"
            or not isinstance(paragraph.get("text"), str)
            or not paragraph["text"].strip()
            or len(paragraph["text"]) > max_paragraph_chars
        ):
            raise InputValidationError("A paragraph is empty or exceeds the documented limit.")


__all__ = [
    "InputValidationError",
    "decode_markdown",
    "plain_paragraphs",
    "validate_article_url",
    "validate_filename",
    "validate_paragraphs",
]
