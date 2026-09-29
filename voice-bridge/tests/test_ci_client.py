"""Tests for how the ci-server client names a failed call."""
import asyncio

import aiohttp
import pytest

from src.client.ci_client import (
    AUTH,
    BAD_RESPONSE,
    RATE_LIMIT,
    TIMEOUT,
    UNREACHABLE,
    CIServerError,
    classify,
)


@pytest.mark.parametrize(
    "exc,kind",
    [
        (CIServerError("HTTP 401", status=401), AUTH),
        (CIServerError("HTTP 403", status=403), AUTH),
        (CIServerError("HTTP 429", status=429), RATE_LIMIT),
        (CIServerError("HTTP 500", status=500), UNREACHABLE),
        (CIServerError("HTTP 502", status=502), UNREACHABLE),
        (CIServerError("HTTP 503", status=503), UNREACHABLE),
        (CIServerError("HTTP 400", status=400), BAD_RESPONSE),
        (CIServerError("HTTP 404", status=404), BAD_RESPONSE),
        (CIServerError("response was not valid JSON"), BAD_RESPONSE),
        (asyncio.TimeoutError(), TIMEOUT),
        (TimeoutError(), TIMEOUT),
        (aiohttp.ServerTimeoutError("Timeout on reading data from socket"), TIMEOUT),
        (aiohttp.ServerDisconnectedError(), UNREACHABLE),
        (aiohttp.ClientPayloadError("Response payload is not completed"), UNREACHABLE),
        (aiohttp.InvalidURL("not a url"), UNREACHABLE),
        (ValueError("TTS audio is not WAV"), BAD_RESPONSE),
        (KeyError("text"), BAD_RESPONSE),
        (AttributeError("'list' object has no attribute 'get'"), BAD_RESPONSE),
    ],
    ids=lambda value: type(value).__name__ if isinstance(value, BaseException) else value,
)
def test_classify(exc, kind):
    assert classify(exc) == kind


def test_a_status_error_keeps_its_status_and_message():
    exc = CIServerError("HTTP 429: slow down", status=429)
    assert exc.status == 429
    assert str(exc) == "HTTP 429: slow down"
    assert CIServerError("no status").status is None
