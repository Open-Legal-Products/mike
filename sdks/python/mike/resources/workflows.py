from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .._models import ShareLink, Workflow, WorkflowListItem

if TYPE_CHECKING:
    from .._client import AsyncMikeClient, MikeClient


class WorkflowsResource:
    def __init__(self, client: "MikeClient") -> None:
        self._client = client

    def list(self) -> list[WorkflowListItem]:
        response = self._client._request("GET", "/workflows")
        return [WorkflowListItem.model_validate(item) for item in response.json()]

    def get(self, workflow_id: str) -> Workflow:
        response = self._client._request("GET", f"/workflows/{workflow_id}")
        return Workflow.model_validate(response.json())

    def create(self, *, name: str, description: str | None = None, steps: list[dict[str, Any]] | None = None) -> Workflow:
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if steps is not None:
            body["steps"] = steps
        response = self._client._request("POST", "/workflows", json=body)
        return Workflow.model_validate(response.json())

    def update(
        self,
        workflow_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        steps: list[dict[str, Any]] | None = None,
    ) -> Workflow:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        if steps is not None:
            body["steps"] = steps
        response = self._client._request("PATCH", f"/workflows/{workflow_id}", json=body)
        return Workflow.model_validate(response.json())

    def delete(self, workflow_id: str) -> None:
        self._client._request("DELETE", f"/workflows/{workflow_id}")

    def share(self, workflow_id: str, *, expires_in_days: int | None = None) -> ShareLink:
        body: dict[str, Any] = {}
        if expires_in_days is not None:
            body["expiresInDays"] = expires_in_days
        response = self._client._request("POST", f"/workflows/{workflow_id}/share", json=body)
        return ShareLink.model_validate(response.json())

    def export(self, workflow_id: str) -> dict[str, Any]:
        response = self._client._request("GET", f"/workflows/{workflow_id}/export")
        return response.json()

    def import_workflow(self, data: dict[str, Any]) -> Workflow:
        response = self._client._request("POST", "/workflows/import", json=data)
        return Workflow.model_validate(response.json())


class AsyncWorkflowsResource:
    def __init__(self, client: "AsyncMikeClient") -> None:
        self._client = client

    async def list(self) -> list[WorkflowListItem]:
        response = await self._client._request("GET", "/workflows")
        return [WorkflowListItem.model_validate(item) for item in response.json()]

    async def get(self, workflow_id: str) -> Workflow:
        response = await self._client._request("GET", f"/workflows/{workflow_id}")
        return Workflow.model_validate(response.json())

    async def create(self, *, name: str, description: str | None = None, steps: list[dict[str, Any]] | None = None) -> Workflow:
        body: dict[str, Any] = {"name": name}
        if description is not None:
            body["description"] = description
        if steps is not None:
            body["steps"] = steps
        response = await self._client._request("POST", "/workflows", json=body)
        return Workflow.model_validate(response.json())

    async def update(
        self,
        workflow_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        steps: list[dict[str, Any]] | None = None,
    ) -> Workflow:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        if description is not None:
            body["description"] = description
        if steps is not None:
            body["steps"] = steps
        response = await self._client._request("PATCH", f"/workflows/{workflow_id}", json=body)
        return Workflow.model_validate(response.json())

    async def delete(self, workflow_id: str) -> None:
        await self._client._request("DELETE", f"/workflows/{workflow_id}")

    async def share(self, workflow_id: str, *, expires_in_days: int | None = None) -> ShareLink:
        body: dict[str, Any] = {}
        if expires_in_days is not None:
            body["expiresInDays"] = expires_in_days
        response = await self._client._request("POST", f"/workflows/{workflow_id}/share", json=body)
        return ShareLink.model_validate(response.json())

    async def export(self, workflow_id: str) -> dict[str, Any]:
        response = await self._client._request("GET", f"/workflows/{workflow_id}/export")
        return response.json()

    async def import_workflow(self, data: dict[str, Any]) -> Workflow:
        response = await self._client._request("POST", "/workflows/import", json=data)
        return Workflow.model_validate(response.json())
