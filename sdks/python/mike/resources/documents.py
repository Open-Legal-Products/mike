from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .._models import Document, DocumentListItem, DocumentVersion

if TYPE_CHECKING:
    from .._client import AsyncMikeClient, MikeClient


class DocumentsResource:
    def __init__(self, client: "MikeClient") -> None:
        self._client = client

    def list(self, *, project_id: str | None = None) -> list[DocumentListItem]:
        params: dict[str, Any] = {}
        if project_id is not None:
            params["projectId"] = project_id
        response = self._client._request("GET", "/single-documents", params=params or None)
        return [DocumentListItem.model_validate(item) for item in response.json()]

    def get(self, document_id: str) -> Document:
        response = self._client._request("GET", f"/single-documents/{document_id}")
        return Document.model_validate(response.json())

    def upload(
        self,
        *,
        title: str,
        content: str | None = None,
        file_url: str | None = None,
        project_id: str | None = None,
    ) -> Document:
        body: dict[str, Any] = {"title": title}
        if content is not None:
            body["content"] = content
        if file_url is not None:
            body["fileUrl"] = file_url
        if project_id is not None:
            body["projectId"] = project_id
        response = self._client._request("POST", "/single-documents", json=body)
        return Document.model_validate(response.json())

    def delete(self, document_id: str) -> None:
        self._client._request("DELETE", f"/single-documents/{document_id}")

    def list_versions(self, document_id: str) -> list[DocumentVersion]:
        response = self._client._request("GET", f"/single-documents/{document_id}/versions")
        return [DocumentVersion.model_validate(v) for v in response.json()]

    def create_version(self, document_id: str, *, content: str) -> DocumentVersion:
        response = self._client._request(
            "POST",
            f"/single-documents/{document_id}/versions",
            json={"content": content},
        )
        return DocumentVersion.model_validate(response.json())


class AsyncDocumentsResource:
    def __init__(self, client: "AsyncMikeClient") -> None:
        self._client = client

    async def list(self, *, project_id: str | None = None) -> list[DocumentListItem]:
        params: dict[str, Any] = {}
        if project_id is not None:
            params["projectId"] = project_id
        response = await self._client._request("GET", "/single-documents", params=params or None)
        return [DocumentListItem.model_validate(item) for item in response.json()]

    async def get(self, document_id: str) -> Document:
        response = await self._client._request("GET", f"/single-documents/{document_id}")
        return Document.model_validate(response.json())

    async def upload(
        self,
        *,
        title: str,
        content: str | None = None,
        file_url: str | None = None,
        project_id: str | None = None,
    ) -> Document:
        body: dict[str, Any] = {"title": title}
        if content is not None:
            body["content"] = content
        if file_url is not None:
            body["fileUrl"] = file_url
        if project_id is not None:
            body["projectId"] = project_id
        response = await self._client._request("POST", "/single-documents", json=body)
        return Document.model_validate(response.json())

    async def delete(self, document_id: str) -> None:
        await self._client._request("DELETE", f"/single-documents/{document_id}")

    async def list_versions(self, document_id: str) -> list[DocumentVersion]:
        response = await self._client._request("GET", f"/single-documents/{document_id}/versions")
        return [DocumentVersion.model_validate(v) for v in response.json()]

    async def create_version(self, document_id: str, *, content: str) -> DocumentVersion:
        response = await self._client._request(
            "POST",
            f"/single-documents/{document_id}/versions",
            json={"content": content},
        )
        return DocumentVersion.model_validate(response.json())
