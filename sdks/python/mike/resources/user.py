from __future__ import annotations

from typing import TYPE_CHECKING, Any

from .._models import ApiKeyStatus, ApiKeyStatusResponse, UserProfile

if TYPE_CHECKING:
    from .._client import AsyncMikeClient, MikeClient


class UserResource:
    def __init__(self, client: "MikeClient") -> None:
        self._client = client

    def get_profile(self) -> UserProfile:
        response = self._client._request("GET", "/user/profile")
        return UserProfile.model_validate(response.json())

    def update_profile(self, *, name: str | None = None) -> UserProfile:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        response = self._client._request("PATCH", "/user/profile", json=body)
        return UserProfile.model_validate(response.json())

    def get_api_keys(self) -> ApiKeyStatusResponse:
        response = self._client._request("GET", "/user/api-keys")
        data = response.json()
        if isinstance(data, list):
            return ApiKeyStatusResponse(keys=[ApiKeyStatus.model_validate(k) for k in data])
        return ApiKeyStatusResponse.model_validate(data)

    def set_api_key(self, provider: str, *, api_key: str) -> None:
        self._client._request(
            "PUT",
            f"/user/api-keys/{provider}",
            json={"apiKey": api_key},
        )

    def delete_api_key(self, provider: str) -> None:
        self._client._request("DELETE", f"/user/api-keys/{provider}")

    def delete_account(self) -> None:
        self._client._request("DELETE", "/user/account")


class AsyncUserResource:
    def __init__(self, client: "AsyncMikeClient") -> None:
        self._client = client

    async def get_profile(self) -> UserProfile:
        response = await self._client._request("GET", "/user/profile")
        return UserProfile.model_validate(response.json())

    async def update_profile(self, *, name: str | None = None) -> UserProfile:
        body: dict[str, Any] = {}
        if name is not None:
            body["name"] = name
        response = await self._client._request("PATCH", "/user/profile", json=body)
        return UserProfile.model_validate(response.json())

    async def get_api_keys(self) -> ApiKeyStatusResponse:
        response = await self._client._request("GET", "/user/api-keys")
        data = response.json()
        if isinstance(data, list):
            return ApiKeyStatusResponse(keys=[ApiKeyStatus.model_validate(k) for k in data])
        return ApiKeyStatusResponse.model_validate(data)

    async def set_api_key(self, provider: str, *, api_key: str) -> None:
        await self._client._request(
            "PUT",
            f"/user/api-keys/{provider}",
            json={"apiKey": api_key},
        )

    async def delete_api_key(self, provider: str) -> None:
        await self._client._request("DELETE", f"/user/api-keys/{provider}")

    async def delete_account(self) -> None:
        await self._client._request("DELETE", "/user/account")
