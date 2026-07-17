from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .._models import Chat, ChatDeltaEvent, ChatListItem
from .._streaming import AsyncStream, SyncStream

if TYPE_CHECKING:
    from .._client import AsyncMikeClient, MikeClient


class ChatResource:
    def __init__(self, client: "MikeClient") -> None:
        self._client = client

    def list(self) -> list[ChatListItem]:
        response = self._client._request("GET", "/chat")
        return [ChatListItem.model_validate(item) for item in response.json()]

    def get(self, chat_id: str) -> Chat:
        response = self._client._request("GET", f"/chat/{chat_id}")
        return Chat.model_validate(response.json())

    def create(
        self,
        *,
        model: str | None = None,
        title: str | None = None,
    ) -> Chat:
        body: dict[str, Any] = {}
        if model is not None:
            body["model"] = model
        if title is not None:
            body["title"] = title
        response = self._client._request("POST", "/chat/create", json=body)
        return Chat.model_validate(response.json())

    def update(self, chat_id: str, *, title: str | None = None, model: str | None = None) -> Chat:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if model is not None:
            body["model"] = model
        response = self._client._request("PATCH", f"/chat/{chat_id}", json=body)
        return Chat.model_validate(response.json())

    def delete(self, chat_id: str) -> None:
        self._client._request("DELETE", f"/chat/{chat_id}")

    def generate_title(self, chat_id: str) -> str:
        response = self._client._request("POST", f"/chat/{chat_id}/generate-title")
        return response.json().get("title", "")

    def stream(
        self,
        *,
        chat_id: str,
        message: str,
        model: str | None = None,
        enable_thinking: bool = False,
        document_ids: list[str] | None = None,
        project_id: str | None = None,
    ) -> SyncStream:
        body: dict[str, Any] = {
            "chatId": chat_id,
            "message": message,
        }
        if model is not None:
            body["model"] = model
        if enable_thinking:
            body["enableThinking"] = True
        if document_ids is not None:
            body["documentIds"] = document_ids
        if project_id is not None:
            body["projectId"] = project_id

        response = self._client._request("POST", "/chat", json=body, stream=True)
        return SyncStream(response)


class AsyncChatResource:
    def __init__(self, client: "AsyncMikeClient") -> None:
        self._client = client

    async def list(self) -> list[ChatListItem]:
        response = await self._client._request("GET", "/chat")
        return [ChatListItem.model_validate(item) for item in response.json()]

    async def get(self, chat_id: str) -> Chat:
        response = await self._client._request("GET", f"/chat/{chat_id}")
        return Chat.model_validate(response.json())

    async def create(
        self,
        *,
        model: str | None = None,
        title: str | None = None,
    ) -> Chat:
        body: dict[str, Any] = {}
        if model is not None:
            body["model"] = model
        if title is not None:
            body["title"] = title
        response = await self._client._request("POST", "/chat/create", json=body)
        return Chat.model_validate(response.json())

    async def update(self, chat_id: str, *, title: str | None = None, model: str | None = None) -> Chat:
        body: dict[str, Any] = {}
        if title is not None:
            body["title"] = title
        if model is not None:
            body["model"] = model
        response = await self._client._request("PATCH", f"/chat/{chat_id}", json=body)
        return Chat.model_validate(response.json())

    async def delete(self, chat_id: str) -> None:
        await self._client._request("DELETE", f"/chat/{chat_id}")

    async def generate_title(self, chat_id: str) -> str:
        response = await self._client._request("POST", f"/chat/{chat_id}/generate-title")
        return response.json().get("title", "")

    async def stream(
        self,
        *,
        chat_id: str,
        message: str,
        model: str | None = None,
        enable_thinking: bool = False,
        document_ids: list[str] | None = None,
        project_id: str | None = None,
    ) -> AsyncStream:
        body: dict[str, Any] = {
            "chatId": chat_id,
            "message": message,
        }
        if model is not None:
            body["model"] = model
        if enable_thinking:
            body["enableThinking"] = True
        if document_ids is not None:
            body["documentIds"] = document_ids
        if project_id is not None:
            body["projectId"] = project_id

        response = await self._client._request("POST", "/chat", json=body, stream=True)
        return AsyncStream(response)
