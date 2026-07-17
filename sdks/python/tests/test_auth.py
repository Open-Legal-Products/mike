"""Auth-header tests.

These assert that the SDK authenticates the way the API's auth middleware
expects (``apps/api/src/middleware/auth.ts``): an
``Authorization: Bearer <token>`` header carrying the Supabase access token,
and *not* a ``Cookie: better-auth...`` header.
"""

from __future__ import annotations

import httpx
import pytest
import respx

from mike import AsyncMikeClient, MikeClient

BASE_URL = "https://api.example.com"
TOKEN = "supabase-access-token-123"


@respx.mock
def test_sync_client_sends_bearer_not_cookie():
    route = respx.get(f"{BASE_URL}/chat").mock(
        return_value=httpx.Response(200, json=[])
    )

    client = MikeClient(base_url=BASE_URL, access_token=TOKEN)
    client.chat.list()

    request = route.calls.last.request
    assert request.headers.get("Authorization") == f"Bearer {TOKEN}"
    assert "Cookie" not in request.headers


@pytest.mark.asyncio
@respx.mock
async def test_async_client_sends_bearer_not_cookie():
    route = respx.get(f"{BASE_URL}/chat").mock(
        return_value=httpx.Response(200, json=[])
    )

    client = AsyncMikeClient(base_url=BASE_URL, access_token=TOKEN)
    await client.chat.list()

    request = route.calls.last.request
    assert request.headers.get("Authorization") == f"Bearer {TOKEN}"
    assert "Cookie" not in request.headers


@respx.mock
def test_no_token_sends_no_auth_header():
    route = respx.get(f"{BASE_URL}/chat").mock(
        return_value=httpx.Response(200, json=[])
    )

    client = MikeClient(base_url=BASE_URL)
    client.chat.list()

    request = route.calls.last.request
    assert "Authorization" not in request.headers
    assert "Cookie" not in request.headers
