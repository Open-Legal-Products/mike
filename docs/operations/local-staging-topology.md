# ROSS local and staging topology

ROSS keeps the inherited frontend and backend independently runnable while the
public website remains a separate application.

## Local services

| Service | Default URL | Configuration |
|---|---|---|
| Public website | `http://localhost:4173` | `NEXT_PUBLIC_ROSS_APP_URL`, `NEXT_PUBLIC_ROSS_WEBSITE_URL` |
| Authenticated app | `http://localhost:3000` | `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_ROSS_WEBSITE_URL` |
| API | `http://localhost:3001` | `CORS_ALLOWED_ORIGINS`, `ROSS_ENV`, provider and storage settings |

Start each application with its existing development command. The public site
links to the authenticated app; the app links back to the public site; and the
API accepts browser requests only from the exact comma-separated origins in
`CORS_ALLOWED_ORIGINS`.

## Staging boundary

- Use `ROSS_ENV=staging` and distinct authentication, database, storage,
  provider, email, and encryption credentials.
- Set website, app, and API URLs explicitly. Do not use `.invalid`, localhost,
  or production credentials.
- Allow only the staging app origin through API CORS.
- Keep staging invitation-only and use synthetic or non-confidential fixtures.
- Configure auth callbacks for signup, email confirmation, password reset, MFA,
  and logout before exercising cross-application journeys.
- Run the root verification gate plus the topology and preserved-Mike contracts
  before promoting a staging revision.

## Production guard

The API refuses to start in `ROSS_ENV=production` when core auth, download,
storage, or allowed-origin settings are absent, placeholders, or local URLs.
Provider credentials remain optional when that provider is disabled or an
approved bulk source is configured.

## Remaining deployment evidence

An isolated staging deployment and its browser-auth journey require hosted
authentication and infrastructure decisions. Those are retained as acceptance
evidence for Delivery A and are not claimed by the local topology foundation.
