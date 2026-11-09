"""Deterministic verdict tests for live redirect security checks."""

import importlib.util
from pathlib import Path

import pytest

from comourat.fetch import FetchPolicyError


def load_security_module():
    path = Path(__file__).parents[1] / "security_live_checks.py"
    spec = importlib.util.spec_from_file_location("security_live_checks", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FakeListener:
    def drain(self):
        return 0


class FakeResponse:
    def __init__(self, status_code, location):
        self.status_code = status_code
        self.headers = {"Location": location}

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def test_redirect_source_must_return_the_exact_controlled_target(monkeypatch):
    module = load_security_module()
    monkeypatch.setattr(
        module.requests,
        "get",
        lambda *args, **kwargs: FakeResponse(302, "http://127.0.0.1/other/"),
    )
    assert module.redirect_source_works("https://redirect.test", "http://127.0.0.1/") is False


def test_redirect_policy_rejection_passes_after_exact_source_preflight(monkeypatch):
    module = load_security_module()
    monkeypatch.setattr(module, "redirect_source_works", lambda url, target: True)

    class RejectingFetcher:
        def __init__(self, **kwargs):
            pass

        def fetch(self, url):
            raise FetchPolicyError("denied")

    monkeypatch.setattr(module, "PageFetcher", RejectingFetcher)
    result = module.redirect_check("https://redirect.test", FakeListener(), "http://127.0.0.1/")
    assert result["status"] == "pass"
    assert result["connections"] == 0


@pytest.mark.parametrize(
    ("source_healthy", "expected_status"),
    [(False, "blocked"), (True, "fail")],
)
def test_redirect_failure_distinguishes_source_outage_from_policy_failure(
    monkeypatch, source_healthy, expected_status
):
    module = load_security_module()
    monkeypatch.setattr(
        module,
        "redirect_source_works",
        lambda url, target: source_healthy,
    )

    class FailingFetcher:
        def __init__(self, **kwargs):
            pass

        def fetch(self, url):
            raise RuntimeError("provider failed")

    monkeypatch.setattr(module, "PageFetcher", FailingFetcher)
    result = module.redirect_check("https://redirect.test", FakeListener(), "http://127.0.0.1/")
    assert result["status"] == expected_status
