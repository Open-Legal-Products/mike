from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .._models import TabularListItem, TabularReview
from .._streaming import AsyncStream, SyncStream

if TYPE_CHECKING:
    from .._client import AsyncMikeClient, MikeClient


class TabularResource:
    def __init__(self, client: "MikeClient") -> None:
        self._client = client

    def list(self) -> list[TabularListItem]:
        response = self._client._request("GET", "/tabular-review")
        return [TabularListItem.model_validate(item) for item in response.json()]

    def get(self, review_id: str) -> TabularReview:
        response = self._client._request("GET", f"/tabular-review/{review_id}")
        return TabularReview.model_validate(response.json())

    def create(
        self,
        *,
        name: str | None = None,
        columns: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> TabularReview:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if columns is not None:
            body["columns"] = columns
        if model is not None:
            body["model"] = model
        response = self._client._request("POST", "/tabular-review", json=body)
        return TabularReview.model_validate(response.json())

    def update(
        self,
        review_id: str,
        *,
        name: str | None = None,
        columns: list[dict[str, Any]] | None = None,
        rows: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> TabularReview:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if columns is not None:
            body["columns"] = columns
        if rows is not None:
            body["rows"] = rows
        if model is not None:
            body["model"] = model
        response = self._client._request("PATCH", f"/tabular-review/{review_id}", json=body)
        return TabularReview.model_validate(response.json())

    def delete(self, review_id: str) -> None:
        self._client._request("DELETE", f"/tabular-review/{review_id}")

    def generate(
        self,
        review_id: str,
        *,
        row_indices: list[int] | None = None,
        column_ids: list[str] | None = None,
    ) -> SyncStream:
        body: dict[str, Any] = {}
        if row_indices is not None:
            body["rowIndices"] = row_indices
        if column_ids is not None:
            body["columnIds"] = column_ids
        response = self._client._request(
            "POST", f"/tabular-review/{review_id}/generate", json=body, stream=True
        )
        return SyncStream(response)

    def chat(
        self,
        review_id: str,
        *,
        message: str,
        model: str | None = None,
    ) -> SyncStream:
        body: dict[str, Any] = {"message": message}
        if model is not None:
            body["model"] = model
        response = self._client._request(
            "POST", f"/tabular-review/{review_id}/chat", json=body, stream=True
        )
        return SyncStream(response)


class AsyncTabularResource:
    def __init__(self, client: "AsyncMikeClient") -> None:
        self._client = client

    async def list(self) -> list[TabularListItem]:
        response = await self._client._request("GET", "/tabular-review")
        return [TabularListItem.model_validate(item) for item in response.json()]

    async def get(self, review_id: str) -> TabularReview:
        response = await self._client._request("GET", f"/tabular-review/{review_id}")
        return TabularReview.model_validate(response.json())

    async def create(
        self,
        *,
        name: str | None = None,
        columns: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> TabularReview:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if columns is not None:
            body["columns"] = columns
        if model is not None:
            body["model"] = model
        response = await self._client._request("POST", "/tabular-review", json=body)
        return TabularReview.model_validate(response.json())

    async def update(
        self,
        review_id: str,
        *,
        name: str | None = None,
        columns: list[dict[str, Any]] | None = None,
        rows: list[dict[str, Any]] | None = None,
        model: str | None = None,
    ) -> TabularReview:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if columns is not None:
            body["columns"] = columns
        if rows is not None:
            body["rows"] = rows
        if model is not None:
            body["model"] = model
        response = await self._client._request("PATCH", f"/tabular-review/{review_id}", json=body)
        return TabularReview.model_validate(response.json())

    async def delete(self, review_id: str) -> None:
        await self._client._request("DELETE", f"/tabular-review/{review_id}")

    async def generate(
        self,
        review_id: str,
        *,
        row_indices: list[int] | None = None,
        column_ids: list[str] | None = None,
    ) -> AsyncStream:
        body: dict[str, Any] = {}
        if row_indices is not None:
            body["rowIndices"] = row_indices
        if column_ids is not None:
            body["columnIds"] = column_ids
        response = await self._client._request(
            "POST", f"/tabular-review/{review_id}/generate", json=body, stream=True
        )
        return AsyncStream(response)

    async def chat(
        self,
        review_id: str,
        *,
        message: str,
        model: str | None = None,
    ) -> AsyncStream:
        body: dict[str, Any] = {"message": message}
        if model is not None:
            body["model"] = model
        response = await self._client._request(
            "POST", f"/tabular-review/{review_id}/chat", json=body, stream=True
        )
        return AsyncStream(response)
