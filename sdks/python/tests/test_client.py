"""Unit tests for MikeClient and AsyncMikeClient using respx mocking."""

from __future__ import annotations

import pytest
import respx
import httpx

from mike import MikeClient, AsyncMikeClient
from mike._exceptions import AuthenticationError, NotFoundError


BASE_URL = "https://api.example.com"


@pytest.fixture
def client():
    return MikeClient(base_url=BASE_URL, access_token="test-token")


@pytest.fixture
def async_client():
    return AsyncMikeClient(base_url=BASE_URL, access_token="test-token")


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

@respx.mock
def test_chat_list(client):
    respx.get(f"{BASE_URL}/chat").mock(return_value=httpx.Response(200, json=[
        {"id": "c1", "title": "Test chat"},
    ]))
    chats = client.chat.list()
    assert len(chats) == 1
    assert chats[0].id == "c1"
    assert chats[0].title == "Test chat"


@respx.mock
def test_chat_get(client):
    respx.get(f"{BASE_URL}/chat/c1").mock(return_value=httpx.Response(200, json={
        "id": "c1",
        "title": "Test",
        "messages": [{"role": "user", "content": "Hello"}],
    }))
    chat = client.chat.get("c1")
    assert chat.id == "c1"
    assert len(chat.messages) == 1
    assert chat.messages[0].content == "Hello"


@respx.mock
def test_chat_create(client):
    respx.post(f"{BASE_URL}/chat/create").mock(return_value=httpx.Response(200, json={
        "id": "c2", "model": "gemini-3-flash-preview",
    }))
    chat = client.chat.create(model="gemini-3-flash-preview")
    assert chat.id == "c2"


@respx.mock
def test_chat_delete(client):
    respx.delete(f"{BASE_URL}/chat/c1").mock(return_value=httpx.Response(200, json={}))
    client.chat.delete("c1")  # should not raise


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

@respx.mock
def test_document_list(client):
    respx.get(f"{BASE_URL}/single-documents").mock(return_value=httpx.Response(200, json=[
        {"id": "d1", "title": "Contract"},
    ]))
    docs = client.documents.list()
    assert docs[0].id == "d1"


@respx.mock
def test_document_upload(client):
    respx.post(f"{BASE_URL}/single-documents").mock(return_value=httpx.Response(200, json={
        "id": "d2", "title": "NDA",
    }))
    doc = client.documents.upload(title="NDA", content="This agreement...")
    assert doc.id == "d2"


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

@respx.mock
def test_project_create(client):
    respx.post(f"{BASE_URL}/projects").mock(return_value=httpx.Response(200, json={
        "id": "p1", "name": "Due Diligence",
    }))
    project = client.projects.create(name="Due Diligence")
    assert project.name == "Due Diligence"


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------

@respx.mock
def test_get_profile(client):
    respx.get(f"{BASE_URL}/user/profile").mock(return_value=httpx.Response(200, json={
        "id": "u1", "email": "test@example.com",
    }))
    profile = client.user.get_profile()
    assert profile.email == "test@example.com"


@respx.mock
def test_set_api_key(client):
    respx.put(f"{BASE_URL}/user/api-keys/claude").mock(return_value=httpx.Response(200, json={}))
    client.user.set_api_key("claude", api_key="sk-ant-test")  # should not raise


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------

@respx.mock
def test_401_raises_authentication_error(client):
    respx.get(f"{BASE_URL}/chat").mock(return_value=httpx.Response(401, json={"error": "Unauthorized"}))
    with pytest.raises(AuthenticationError):
        client.chat.list()


@respx.mock
def test_404_raises_not_found(client):
    respx.get(f"{BASE_URL}/chat/missing").mock(return_value=httpx.Response(404, json={"error": "Not found"}))
    with pytest.raises(NotFoundError):
        client.chat.get("missing")


# ---------------------------------------------------------------------------
# Async client
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@respx.mock
async def test_async_chat_list(async_client):
    respx.get(f"{BASE_URL}/chat").mock(return_value=httpx.Response(200, json=[
        {"id": "c1", "title": "Async chat"},
    ]))
    chats = await async_client.chat.list()
    assert chats[0].id == "c1"


@pytest.mark.asyncio
@respx.mock
async def test_async_project_list(async_client):
    respx.get(f"{BASE_URL}/projects").mock(return_value=httpx.Response(200, json=[
        {"id": "p1", "name": "My Project"},
    ]))
    projects = await async_client.projects.list()
    assert projects[0].name == "My Project"
