"""Tests for live source-check configuration helpers."""

import importlib.util
from pathlib import Path


def load_source_module():
    path = Path(__file__).parents[1] / "source_live_checks.py"
    spec = importlib.util.spec_from_file_location("source_live_checks", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_chat_completions_endpoint_is_normalized_to_provider_base_url():
    module = load_source_module()
    assert module.normalize_openai_base_url(
        "https://caila.io/api/openai/v1/chat/completions"
    ) == "https://caila.io/api/openai/v1"


def test_existing_base_url_is_preserved_without_trailing_slash():
    module = load_source_module()
    assert module.normalize_openai_base_url(
        "https://caila.io/api/openai/v1/"
    ) == "https://caila.io/api/openai/v1"
    assert module.normalize_openai_base_url(None) is None
