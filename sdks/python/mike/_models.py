from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Chat
# ---------------------------------------------------------------------------

class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class Chat(BaseModel):
    id: str
    title: Optional[str] = None
    messages: list[Message] = Field(default_factory=list)
    model: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ChatListItem(BaseModel):
    id: str
    title: Optional[str] = None
    model: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# Streamed events from POST /chat (SSE)
class ChatDeltaEvent(BaseModel):
    type: Literal["content_delta", "reasoning_delta", "tool_call_start", "done", "error"]
    text: Optional[str] = None
    tool_call: Optional[dict[str, Any]] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------

class DocumentVersion(BaseModel):
    id: str
    version_number: int
    created_at: Optional[datetime] = None


class Document(BaseModel):
    id: str
    title: Optional[str] = None
    content: Optional[str] = None
    file_url: Optional[str] = None
    versions: list[DocumentVersion] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class DocumentListItem(BaseModel):
    id: str
    title: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Projects
# ---------------------------------------------------------------------------

class Project(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class ProjectListItem(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# Tabular review
# ---------------------------------------------------------------------------

class TabularReview(BaseModel):
    id: str
    name: Optional[str] = None
    columns: list[dict[str, Any]] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    model: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TabularListItem(BaseModel):
    id: str
    name: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class TabularGenerateDeltaEvent(BaseModel):
    type: Literal["cell_delta", "cell_done", "done", "error"]
    row_index: Optional[int] = None
    column_id: Optional[str] = None
    text: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# Workflows
# ---------------------------------------------------------------------------

class WorkflowStep(BaseModel):
    id: str
    type: str
    config: dict[str, Any] = Field(default_factory=dict)


class Workflow(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    steps: list[WorkflowStep] = Field(default_factory=list)
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None


class WorkflowListItem(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None


class ShareLink(BaseModel):
    url: str
    token: str
    expires_at: Optional[datetime] = None


# ---------------------------------------------------------------------------
# User / API keys
# ---------------------------------------------------------------------------

class UserProfile(BaseModel):
    id: str
    email: Optional[str] = None
    name: Optional[str] = None
    created_at: Optional[datetime] = None


class ApiKeyStatus(BaseModel):
    provider: str
    configured: bool
    source: Optional[Literal["user", "env"]] = None


class ApiKeyStatusResponse(BaseModel):
    keys: list[ApiKeyStatus] = Field(default_factory=list)
