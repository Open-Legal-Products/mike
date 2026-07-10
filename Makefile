# Mike Atlas — local development commands
# This Makefile prefers modern "docker compose" and falls back to "docker-compose".

REPO_ROOT := $(shell pwd)

ifeq ($(shell docker compose version >/dev/null 2>&1 && echo yes),yes)
  DOCKER_COMPOSE := docker compose
else ifeq ($(shell docker-compose version >/dev/null 2>&1 && echo yes),yes)
  DOCKER_COMPOSE := docker-compose
else
  $(error Docker Compose is required. Install "docker compose" or "docker-compose".
endif

.PHONY: doctor bootstrap dev status smoke-local logs stop reset db-status db-verify db-reset shell

doctor: ## Check prerequisites without changing state
	@bash scripts/doctor.sh

bootstrap: ## Install deps, generate secrets and start Supabase + MinIO
	@bash scripts/bootstrap.sh

dev: ## Start the full local stack (frontend, backend)
	@bash scripts/start-local.sh

status: ## Show running services and health status
	@bash scripts/status.sh

smoke-local: ## Run local smoke tests (requires stack running)
	@bash scripts/smoke-local.sh

smoke-local-ai: ## Optional AI smoke test if a disposable LLM key is present
	@bash scripts/smoke-local.sh --ai

logs: ## Tail all local service logs
	$(DOCKER_COMPOSE) logs -f

stop: ## Stop services without destroying data
	@bash scripts/stop-local.sh

reset: ## Destroy local data only (requires CONFIRM=local-only)
	@bash scripts/reset-local.sh

db-status: ## Show local database migration status
	@bash scripts/db-status.sh

db-verify: ## Verify local database schema and objects
	@bash scripts/db-verify.sh

db-reset: ## Reset local database (requires CONFIRM=local-only)
	@bash scripts/db-reset.sh

shell: ## Open a shell in the backend container
	$(DOCKER_COMPOSE) exec backend /bin/bash
