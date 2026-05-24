# API

The Express API lives in `apps/api`. The typed client lives in
`packages/api-client` and is the preferred way for first-party TypeScript code
to call the API.

Configure the client with a base URL and an auth-header provider:

```ts
import { configureMikeApiClient, listProjects } from "@mike/api-client";

configureMikeApiClient({
  baseUrl: "http://localhost:3001",
  async getAuthHeaders() {
    return { Authorization: `Bearer ${token}` };
  },
});

const projects = await listProjects();
```

Public request and response shapes should be defined in `packages/core` before
they are consumed by API handlers, the web app, or SDKs.
