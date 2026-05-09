# AGENTS.md

## Workflow

- Work on a dedicated branch from the latest `origin/main` for repo changes.
- Before opening a PR, fetch and update the branch with the latest `origin/main`.
- If a Linear ticket is provided for the work, update it with the implementation and documentation changes before opening the PR.
- Keep documentation current with implementation changes. For deployment work, update `README.md`, relevant `docs/` pages, and this file when project workflow changes.
- Stage only the files related to the requested change.

## GCP Deployment Notes

- The GCP target for this repo is Cloud Run, with separate services for `frontend/` and `backend/`.
- Use `scripts/gcp/setup-project.sh` to create/prepare a GCP project and Artifact Registry repository.
- Use `scripts/gcp/deploy-cloud-run.sh` to build images, store runtime secrets in Secret Manager, deploy the backend, deploy the frontend, and update backend CORS with the final frontend URL.
- Keep Ornn install access restricted with `ALLOWED_EMAIL_DOMAINS=ornn.com`; add explicitly approved outside users through `ALLOWED_EMAILS`.
- The app still depends on external Supabase Auth/Postgres and S3-compatible object storage unless the application code is changed to use GCP-native replacements.
