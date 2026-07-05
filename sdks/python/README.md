# Mike Python SDK

Python client for the [Mike](https://github.com/willchen96/mike) legal AI API,
with synchronous and asynchronous clients, typed Pydantic models, and SSE
streaming for chat.

Requires Python 3.9+.

## Install

```bash
pip install -e .          # from this directory
pip install -e .[dev]     # with test dependencies (pytest, respx)
```

## Usage

```python
from mike import MikeClient

client = MikeClient(
    base_url="http://localhost:3001",
    access_token="<supabase-access-token>",  # sent as Authorization: Bearer
)

projects = client.projects.list()
chat = client.chat.create(project_id=projects[0].id)

for event in client.chat.stream(chat.id, message="Summarise the uploaded NDA."):
    print(event)
```

Async variant (same resource surface):

```python
from mike import AsyncMikeClient

async with AsyncMikeClient(base_url="http://localhost:3001", access_token=token) as client:
    chats = await client.chat.list()
```

Resources mirror the API's route modules: `chat`, `documents`, `projects`,
`tabular`, `workflows`, `user`.

## Errors

HTTP failures raise typed exceptions (`AuthenticationError`, `NotFoundError`,
`RateLimitError`, … — all subclasses of `APIError`, which carries the response
status and body), so callers can branch on the failure kind without parsing
strings.

## Development

The test suite is fully offline — HTTP is mocked with
[respx](https://lundberg.github.io/respx/), so no running API or secrets are
needed:

```bash
pip install -e .[dev]
python -m pytest
```

CI runs this suite on Python 3.9 (the oldest supported version) for every
pull request.

## Contract note

This SDK is handwritten against the API in `apps/api`. When you change an API
route the SDK covers, update the matching resource module and its test in the
same pull request — there is no generated spec to catch drift yet (see
`docs/ROADMAP.md`).
