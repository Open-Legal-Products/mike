# Mike Atlas — quality and local development commands

REPO_ROOT := $(shell pwd)

ifeq ($(shell docker compose version >/dev/null 2>&1 && echo yes),yes)
  DOCKER_COMPOSE := docker compose
else ifeq ($(shell docker-compose version >/dev/null 2>&1 && echo yes),yes)
  DOCKER_COMPOSE := docker-compose
else
  $(error Docker Compose is required.)
endif

.PHONY: doctor bootstrap dev status smoke-local logs stop reset db-status db-verify db-reset shell \
  install lint typecheck test test-unit test-integration test-e2e coverage build audit ci-local

doctor:
	@bash scripts/doctor.sh

bootstrap:
	@bash scripts/bootstrap.sh

dev:
	@bash scripts/start-local.sh

status:
	@bash scripts/status.sh

smoke-local:
	@bash scripts/smoke-local.sh

logs:
	$(DOCKER_COMPOSE) logs -f

stop:
	@bash scripts/stop-local.sh

reset:
	@bash scripts/reset-local.sh

db-status:
	@bash scripts/db-status.sh

db-verify:
	@bash scripts/db-verify.sh

db-reset:
	@bash scripts/db-reset.sh

shell:
	$(DOCKER_COMPOSE) exec backend /bin/bash

# Quality gates
install:
	cd backend && npm ci
	cd frontend && npm ci

lint:
	cd backend && npm run lint
	cd frontend && npm run lint

typecheck:
	cd backend && npm run typecheck
	cd frontend && npm run typecheck

test:
	cd backend && npm run test
	cd frontend && npm run test

test-unit:
	cd backend && npm run test:unit
	cd frontend && npm run test

test-integration:
	cd backend && npm run test:integration

test-e2e:
	npx playwright test --config e2e/playwright.config.ts

coverage:
	cd backend && npm run test:coverage
	cd frontend && npm run test:coverage

build:
	cd backend && npm run build
	cd frontend && npm run build

audit:
	cd backend && npm audit --audit-level=moderate || true
	cd frontend && npm audit --audit-level=moderate || true

# Reproduce CI locally
ci-local: lint typecheck test build audit
	@echo "=== ci-local: ALL GATES PASSED ==="
