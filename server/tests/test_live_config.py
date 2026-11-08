"""Tests for shared live-check policy and evidence sanitization."""

import pytest

from vesna.live_config import make_live_fetch_policy, sanitized_source_url


def test_tts_host_is_denied_in_shared_policy():
    policy = make_live_fetch_policy("vesna-test-tts.invalid")
    assert policy.deny_hosts == frozenset({"vesna-test-tts.invalid"})
    assert policy.overall_timeout == 60
    assert policy.connection_timeout == 10
    assert policy.read_timeout == 30


def test_source_url_removes_query_fragment_and_credentials():
    assert sanitized_source_url(
        "https://example.test/path/to/article?token=secret#section"
    ) == "https://example.test/path/to/article"
    assert sanitized_source_url(
        "https://[2001:db8::1]:8443/path?token=secret"
    ) == "https://[2001:db8::1]:8443/path"


@pytest.mark.parametrize(
    "url",
    [
        "https://user@example.test/path",
        "https://user:password@example.test/path",
        "file:///tmp/article",
        "not a URL",
    ],
)
def test_unsafe_or_invalid_source_urls_are_rejected(url):
    with pytest.raises(ValueError):
        sanitized_source_url(url)
