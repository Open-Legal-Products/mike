# JavaScript SDK

The JavaScript SDK lives in `packages/sdk-js`. It wraps the lower-level
`@mike/api-client` package with a small class-based facade.

```ts
import { MikeClient } from "@mike/sdk-js";

const mike = new MikeClient({
  baseUrl: "https://api.example.com",
  apiKey: "user-or-service-token",
});

const projects = await mike.projects.list();
```

The SDK should stay thin. Add shared types and stable contracts to
`packages/core`, low-level endpoint calls to `packages/api-client`, and ergonomic
workflows to `packages/sdk-js`.
