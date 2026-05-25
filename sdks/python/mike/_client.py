from __future__ import annotations

from typing import Any

import httpx

from ._exceptions import _raise_for_status
from .resources.chat import ChatResource, AsyncChatResource
from .resources.documents import DocumentsResource, AsyncDocumentsResource
from .resources.projects import ProjectsResource, AsyncProjectsResource
from .resources.tabular import TabularResource, AsyncTabularResource
from .resources.user import UserResource, AsyncUserResource
from .resources.workflows import WorkflowsResource, AsyncWorkflowsResource


class MikeClient:
    """Synchronous client for the Mike legal AI API."""

    chat: ChatResource
    documents: DocumentsResource
    projects: ProjectsResource
    tabular: TabularResource
    workflows: WorkflowsResource
    user: UserResource

    def __init__(
        self,
        *,
        base_url: str,
        session_token: str | None = None,
        timeout: float = 60.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if session_token:
            headers["Cookie"] = f"better-auth.session_token={session_token}"

        self._http = http_client or httpx.Client(
            base_url=self._base_url,
            headers=headers,
            timeout=timeout,
        )

        self.chat = ChatResource(self)
        self.documents = DocumentsResource(self)
        self.projects = ProjectsResource(self)
        self.tabular = TabularResource(self)
        self.workflows = WorkflowsResource(self)
        self.user = UserResource(self)

    def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> httpx.Response:
        response = self._http.request(
            method,
            path,
            json=json,
            params=params,
            headers={"Accept": "text/event-stream"} if stream else {},
        )
        if not stream:
            try:
                body = response.json()
            except Exception:
                body = response.text
            _raise_for_status(response.status_code, body)
        return response

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "MikeClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()


class AsyncMikeClient:
    """Async client for the Mike legal AI API."""

    chat: AsyncChatResource
    documents: AsyncDocumentsResource
    projects: AsyncProjectsResource
    tabular: AsyncTabularResource
    workflows: AsyncWorkflowsResource
    user: AsyncUserResource

    def __init__(
        self,
        *,
        base_url: str,
        session_token: str | None = None,
        timeout: float = 60.0,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        headers: dict[str, str] = {"Content-Type": "application/json"}
        if session_token:
            headers["Cookie"] = f"better-auth.session_token={session_token}"

        self._http = http_client or httpx.AsyncClient(
            base_url=self._base_url,
            headers=headers,
            timeout=timeout,
        )

        self.chat = AsyncChatResource(self)
        self.documents = AsyncDocumentsResource(self)
        self.projects = AsyncProjectsResource(self)
        self.tabular = AsyncTabularResource(self)
        self.workflows = AsyncWorkflowsResource(self)
        self.user = AsyncUserResource(self)

    async def _request(
        self,
        method: str,
        path: str,
        *,
        json: Any = None,
        params: dict[str, Any] | None = None,
        stream: bool = False,
    ) -> httpx.Response:
        response = await self._http.request(
            method,
            path,
            json=json,
            params=params,
            headers={"Accept": "text/event-stream"} if stream else {},
        )
        if not stream:
            try:
                body = response.json()
            except Exception:
                body = response.text
            _raise_for_status(response.status_code, body)
        return response

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> "AsyncMikeClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.aclose()
