# Testing Guide

## Test Pyramid

```
        /\
       /E2E\      ← Playwright (few, critical flows)
      /------\
     /Integ.\    ← Vitest + real Supabase/MinIO (some)
    /----------\
   /  Unit tests \  ← Vitest (many, fast)
  /----------------\
```

## Running Tests

```bash
# All backend tests
npm run test --prefix backend

# Unit tests only
npm run test:unit --prefix backend

# Integration tests (requires Supabase + MinIO)
npm run test:integration --prefix backend

# Frontend tests
npm run test --prefix frontend

# E2E
make test-e2e

# Coverage
make coverage
```

## Test Data

All tests use synthetic data:
- Users: synthetic Supabase auth users
- Documents: `test/fixtures/documents/` (watermarked)
- Keys: fake strings, never real API keys
- Database: local Supabase only

## Security Tests

Tests that verify authentication is enforced on protected endpoints:

```typescript
it("case-law endpoint rejects anonymous request", async ({ page }) => {
  const response = await page.request.post(
    "http://localhost:3001/case-law/case-opinions",
    { data: { clusterId: 1 } },
  );
  expect(response.status()).toBe(401);
});
```

## Flaky Test Policy

- No flaky tests accepted as normal
- Max 1 retry in Playwright CI
- Trace preserved on failure
- If a test depends on retry, it's a defect

## Coverage

Coverage is reported as:
- Text output in CI
- LCOV file as artifact
- HTML report locally in `coverage/`
