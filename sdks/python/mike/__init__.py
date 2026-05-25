"""Mike Python SDK — sync and async clients for the Mike legal AI API."""

from ._client import AsyncMikeClient, MikeClient
from ._exceptions import (
    APIError,
    AuthenticationError,
    InternalServerError,
    MikeError,
    NotFoundError,
    PermissionError,
    RateLimitError,
    StreamError,
)
from ._models import (
    ApiKeyStatus,
    ApiKeyStatusResponse,
    Chat,
    ChatDeltaEvent,
    ChatListItem,
    Document,
    DocumentListItem,
    DocumentVersion,
    Message,
    Project,
    ProjectListItem,
    ShareLink,
    TabularGenerateDeltaEvent,
    TabularListItem,
    TabularReview,
    UserProfile,
    Workflow,
    WorkflowListItem,
    WorkflowStep,
)
from ._streaming import AsyncStream, SyncStream

__all__ = [
    # Clients
    "MikeClient",
    "AsyncMikeClient",
    # Exceptions
    "MikeError",
    "APIError",
    "AuthenticationError",
    "PermissionError",
    "NotFoundError",
    "RateLimitError",
    "InternalServerError",
    "StreamError",
    # Models
    "Message",
    "Chat",
    "ChatListItem",
    "ChatDeltaEvent",
    "Document",
    "DocumentListItem",
    "DocumentVersion",
    "Project",
    "ProjectListItem",
    "TabularReview",
    "TabularListItem",
    "TabularGenerateDeltaEvent",
    "Workflow",
    "WorkflowListItem",
    "WorkflowStep",
    "ShareLink",
    "UserProfile",
    "ApiKeyStatus",
    "ApiKeyStatusResponse",
    # Streaming
    "SyncStream",
    "AsyncStream",
]
