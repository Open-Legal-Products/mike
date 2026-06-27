# Optional Integrations

This file documents optional third-party integrations that are not required to run Mike. Integrations are server-configured through `backend/.env` and are disabled unless explicitly enabled.

## TrustFoundry

TrustFoundry provides optional legal research and citation validation tools for assistant chats. It is not a model provider, and TrustFoundry API keys are not entered in the browser API key settings.

To enable TrustFoundry for a Mike instance:

1. Create an API key at `https://dashboard.trustfoundry.ai`.
2. Set the following values in `backend/.env`:

```bash
TRUSTFOUNDRY_ENABLED=true
TRUSTFOUNDRY_API_KEY=your-trustfoundry-api-key
TRUSTFOUNDRY_API_BASE_URL=https://api.trustfoundry.ai
```

`TRUSTFOUNDRY_API_BASE_URL` is optional unless you need to point Mike at a different TrustFoundry API endpoint.
