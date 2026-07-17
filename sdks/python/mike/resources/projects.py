from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .._models import Document, DocumentListItem, Project, ProjectListItem

if TYPE_CHECKING:
    from .._client import AsyncMikeClient, MikeClient


class ProjectsResource:
    def __init__(self, client: "MikeClient") -> None:
        self._client = client

    def list(self) -> list[ProjectListItem]:
        response = self._client._request("GET", "/projects")
        return [ProjectListItem.model_validate(item) for item in response.json()]

    def get(self, project_id: str) -> Project:
        response = self._client._request("GET", f"/projects/{project_id}")
        return Project.model_validate(response.json())

    def create(self, *, name: str, description: str | None = None) -> Project:
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        response = self._client._request("POST", "/projects", json=body)
        return Project.model_validate(response.json())

    def update(
        self,
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> Project:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        response = self._client._request("PATCH", f"/projects/{project_id}", json=body)
        return Project.model_validate(response.json())

    def delete(self, project_id: str) -> None:
        self._client._request("DELETE", f"/projects/{project_id}")

    def list_documents(self, project_id: str) -> list[DocumentListItem]:
        response = self._client._request("GET", f"/projects/{project_id}/documents")
        return [DocumentListItem.model_validate(item) for item in response.json()]

    def add_document(self, project_id: str, *, document_id: str) -> Document:
        response = self._client._request(
            "POST",
            f"/projects/{project_id}/documents",
            json={"documentId": document_id},
        )
        return Document.model_validate(response.json())


class AsyncProjectsResource:
    def __init__(self, client: "AsyncMikeClient") -> None:
        self._client = client

    async def list(self) -> list[ProjectListItem]:
        response = await self._client._request("GET", "/projects")
        return [ProjectListItem.model_validate(item) for item in response.json()]

    async def get(self, project_id: str) -> Project:
        response = await self._client._request("GET", f"/projects/{project_id}")
        return Project.model_validate(response.json())

    async def create(self, *, name: str, description: str | None = None) -> Project:
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        response = await self._client._request("POST", "/projects", json=body)
        return Project.model_validate(response.json())

    async def update(
        self,
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> Project:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        response = await self._client._request("PATCH", f"/projects/{project_id}", json=body)
        return Project.model_validate(response.json())

    async def delete(self, project_id: str) -> None:
        await self._client._request("DELETE", f"/projects/{project_id}")

    async def list_documents(self, project_id: str) -> list[DocumentListItem]:
        response = await self._client._request("GET", f"/projects/{project_id}/documents")
        return [DocumentListItem.model_validate(item) for item in response.json()]

    async def add_document(self, project_id: str, *, document_id: str) -> Document:
        response = await self._client._request(
            "POST",
            f"/projects/{project_id}/documents",
            json={"documentId": document_id},
        )
        return Document.model_validate(response.json())
