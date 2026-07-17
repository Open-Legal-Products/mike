from __future__ import annotations

import json
from collections.abc import AsyncIterator, Iterator
from typing import TypeVar

import httpx

from ._exceptions import StreamError

T = TypeVar("T")


def _parse_sse_line(line: str) -> str | None:
    """Return the JSON payload from a ``data: ...`` line, or None."""
    if line.startswith("data:"):
        payload = line[5:].strip()
        if payload and payload != "[DONE]":
            return payload
    return None


class SyncStream(Iterator[dict]):
    """Iterates server-sent events from a synchronous httpx response."""

    def __init__(self, response: httpx.Response) -> None:
        self._response = response
        self._iter = response.iter_lines()

    def __iter__(self) -> Iterator[dict]:
        return self

    def __next__(self) -> dict:
        while True:
            try:
                line = next(self._iter)
            except StopIteration:
                raise
            except Exception as exc:
                raise StreamError(f"Error reading SSE stream: {exc}") from exc
            payload = _parse_sse_line(line)
            if payload is not None:
                try:
                    return json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise StreamError(f"Invalid JSON in SSE stream: {payload!r}") from exc

    def __enter__(self) -> "SyncStream":
        return self

    def __exit__(self, *args: object) -> None:
        self._response.close()


class AsyncStream(AsyncIterator[dict]):
    """Iterates server-sent events from an async httpx response."""

    def __init__(self, response: httpx.Response) -> None:
        self._response = response
        self._iter = response.aiter_lines()

    def __aiter__(self) -> "AsyncStream":
        return self

    async def __anext__(self) -> dict:
        while True:
            try:
                line = await self._iter.__anext__()
            except StopAsyncIteration:
                raise
            except Exception as exc:
                raise StreamError(f"Error reading SSE stream: {exc}") from exc
            payload = _parse_sse_line(line)
            if payload is not None:
                try:
                    return json.loads(payload)
                except json.JSONDecodeError as exc:
                    raise StreamError(f"Invalid JSON in SSE stream: {payload!r}") from exc

    async def __aenter__(self) -> "AsyncStream":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self._response.aclose()
