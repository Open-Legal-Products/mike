from __future__ import annotations

from typing import Any


class MikeError(Exception):
    """Base class for all Mike SDK errors."""

    def __init__(self, message: str, *, status_code: int | None = None, body: Any = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class APIError(MikeError):
    """The API returned a non-2xx response."""


class AuthenticationError(APIError):
    """401 — invalid or missing API key."""


class PermissionError(APIError):
    """403 — insufficient permissions."""


class NotFoundError(APIError):
    """404 — resource not found."""


class RateLimitError(APIError):
    """429 — rate limit exceeded."""


class InternalServerError(APIError):
    """5xx — server-side error."""


class StreamError(MikeError):
    """Error while consuming a server-sent event stream."""


def _raise_for_status(status_code: int, body: Any = None) -> None:
    message = str(body) if body else f"HTTP {status_code}"
    if status_code == 401:
        raise AuthenticationError(message, status_code=status_code, body=body)
    if status_code == 403:
        raise PermissionError(message, status_code=status_code, body=body)
    if status_code == 404:
        raise NotFoundError(message, status_code=status_code, body=body)
    if status_code == 429:
        raise RateLimitError(message, status_code=status_code, body=body)
    if status_code >= 500:
        raise InternalServerError(message, status_code=status_code, body=body)
    if status_code >= 400:
        raise APIError(message, status_code=status_code, body=body)
