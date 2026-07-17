import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");

test("website, app, and API URLs are environment configurable", () => {
  assert.match(read("website/app/site-config.ts"), /NEXT_PUBLIC_ROSS_APP_URL/);
  assert.match(
    read("frontend/src/app/lib/rossBrand.ts"),
    /NEXT_PUBLIC_ROSS_WEBSITE_URL/,
  );
  assert.match(
    read("frontend/.env.local.example"),
    /NEXT_PUBLIC_API_BASE_URL=http:\/\/localhost:3001/,
  );
  assert.match(
    read("website/.env.example"),
    /NEXT_PUBLIC_ROSS_APP_URL=http:\/\/localhost:3000/,
  );
});

test("the API validates its environment and exact CORS origins", () => {
  const runtime = read("backend/src/config/runtime.ts");
  const server = read("backend/src/index.ts");
  assert.match(runtime, /ROSS_ENV/);
  assert.match(runtime, /CORS_ALLOWED_ORIGINS/);
  assert.match(runtime, /Production CORS origins cannot use localhost/);
  assert.match(server, /runtime\.allowedOrigins\.includes\(origin\)/);
  assert.doesNotMatch(server, /origin: process\.env\.FRONTEND_URL/);
});

test("the legal-source model is provider-neutral", () => {
  const types = read("backend/src/lib/legalSources/types.ts");
  const registry = read("backend/src/lib/legalSources/registry.ts");
  assert.match(types, /interface LegalSourceProvider/);
  assert.match(types, /JurisdictionCode/);
  assert.match(types, /LegalDecisionSummary/);
  assert.match(types, /VerificationState/);
  assert.match(registry, /filters\?\.jurisdiction/);
  assert.match(registry, /filters\?\.kind/);
});

test("CourtListener is preserved behind the generic provider", () => {
  const adapter = read("backend/src/lib/legalSources/courtlistenerProvider.ts");
  const route = read("backend/src/routes/caseLaw.ts");
  assert.match(adapter, /id: "courtlistener-us"/);
  assert.match(adapter, /searchCourtlistenerCaseLaw/);
  assert.match(adapter, /getCourtlistenerCaseOpinions/);
  assert.match(adapter, /verifyCourtlistenerCitations/);
  assert.match(route, /legalSources\.get\("courtlistener-us"\)/);
  assert.match(route, /courtListener\s*\.fetchDecision/);
  assert.match(route, /providerPayload/);
});

test("provider status is authenticated and credential-safe", () => {
  const route = read("backend/src/routes/legalSources.ts");
  assert.match(route, /legalSourcesRouter\.use\(requireAuth\)/);
  assert.match(route, /provider\.health/);
  assert.doesNotMatch(route, /res\.json\([^)]*apiToken/s);
});

test("A2AJ is an additive Canadian provider with explicit source limitations", () => {
  const client = read("backend/src/lib/legalSources/a2ajClient.ts");
  const provider = read("backend/src/lib/legalSources/a2ajProvider.ts");
  const route = read("backend/src/routes/legalSources.ts");
  assert.match(client, /https:\/\/api\.a2aj\.ca/);
  assert.match(client, /circuit breaker is open/);
  assert.match(provider, /id: "a2aj-canada"/);
  assert.match(provider, /fullTextStatus: "unofficial"/);
  assert.match(provider, /upstreamLicense/);
  assert.match(route, /knownOntarioGaps/);
  assert.match(route, /decisions\/:providerId\/:sourceId\/passages/);
});

test("official legislation providers retain authority, currency, and reproduction boundaries", () => {
  const provider = read("backend/src/lib/legalSources/officialLegislation.ts");
  const types = read("backend/src/lib/legalSources/types.ts");
  const route = read("backend/src/routes/legalSources.ts");
  assert.match(provider, /id: "ontario-elaws"/);
  assert.match(provider, /id: "justice-laws-canada"/);
  assert.match(
    provider,
    /raw\.githubusercontent\.com\/justicecanada\/laws-lois-xml/,
  );
  assert.match(provider, /allowedHosts/);
  assert.match(provider, /historical-version retrieval/);
  assert.match(types, /reproductionIsOfficial: false/);
  assert.match(types, /currentToDate/);
  assert.match(route, /legislation\/:providerId\/:sourceId/);
});

test("licensed CanLII access is disabled, entitlement-gated, and non-scraping", () => {
  const connector = read("backend/src/lib/legalSources/licensedConnector.ts");
  const environment = read("backend/.env.example");
  assert.match(connector, /id: "canlii-licensed"/);
  assert.match(connector, /enabledByDefault: false/);
  assert.match(connector, /does not scrape CanLII/);
  assert.match(connector, /LicensedConnectorGate/);
  assert.match(connector, /CANLII_FULL_TEXT_ENTITLED/);
  assert.match(connector, /url\.hostname === "api\.canlii\.org"/);
  assert.doesNotMatch(connector, /fetch\(/);
  assert.match(environment, /CANLII_CONNECTOR_ENABLED=false/);
});

test("Canadian citations separate parsing from provider-backed verification", () => {
  const engine = read("backend/src/lib/legalSources/canadianCitations.ts");
  const route = read("backend/src/routes/legalSources.ts");
  assert.match(engine, /parseCanadianCitations/);
  assert.match(engine, /renderCanadianCitation/);
  assert.match(engine, /verifyCanadianCitations/);
  assert.match(engine, /citationVerification: "unverified"/);
  assert.match(engine, /passageVerification/);
  assert.match(engine, /currencyVerification/);
  assert.match(engine, /treatmentVerification/);
  assert.match(route, /citations\/canadian\/parse/);
  assert.match(route, /citations\/canadian\/verify/);
});

test("Ontario defaults are additive and the legacy U.S. feature remains available", () => {
  const migration = read(
    "backend/migrations/20260716_01_ontario_jurisdiction_settings.sql",
  );
  const settings = read("backend/src/lib/userSettings.ts");
  const prompt = read("backend/src/lib/chat/prompts.ts");
  const account = read("frontend/src/app/(pages)/account/features/page.tsx");
  const chat = read("frontend/src/app/components/assistant/ChatInput.tsx");
  assert.match(migration, /default_country text not null default 'CA'/i);
  assert.match(migration, /legal_research_us column remains/i);
  assert.match(settings, /defaultCountry: "CA"/);
  assert.match(settings, /"CA-ON", "CA", "US"/);
  assert.match(settings, /courtlistener-us/);
  assert.match(prompt, /Default jurisdiction:/);
  assert.match(prompt, /retrieve the exact supporting passage/i);
  assert.match(prompt, /Do not silently substitute model memory/i);
  assert.match(account, /Ontario, Canada/);
  assert.match(account, /Federal — Canada/);
  assert.match(account, /United States/);
  assert.match(chat, /Governing jurisdiction/);
});

test("Canadian authority research requires an inspectable retrieved passage", () => {
  const tools = read("backend/src/lib/chat/tools/legalSourceTools.ts");
  const dispatcher = read("backend/src/lib/chat/tools/toolDispatcher.ts");
  const panel = read(
    "frontend/src/app/components/assistant/LegalAuthorityPanel.tsx",
  );
  assert.match(tools, /search_legal_sources/);
  assert.match(tools, /fetch_legal_source/);
  assert.match(tools, /find_in_legal_source/);
  assert.match(tools, /verify_legal_citations/);
  assert.match(tools, /exact passage/i);
  assert.match(dispatcher, /enabledSourceProviders/);
  assert.match(dispatcher, /cleanLegalAuthority/);
  assert.match(panel, /Citation verified/);
  assert.match(panel, /Passage verified/);
  assert.match(panel, /Currency not available/);
  assert.match(panel, /Treatment not available/);
  assert.match(panel, /No exact passage was retrieved/);
});

test("Ontario procedure sources, forms, and deadlines fail safely", () => {
  const procedure = read("backend/src/lib/legalSources/ontarioProcedure.ts");
  const route = read("backend/src/routes/legalSources.ts");
  const migration = read(
    "backend/migrations/20260716_02_ontario_procedure_sources.sql",
  );
  assert.match(procedure, /www\.ontario\.ca/);
  assert.match(procedure, /www\.ontariocourts\.ca/);
  assert.match(procedure, /copyingPolicy: "link-only"/);
  assert.match(procedure, /check-official-current-version/);
  assert.match(
    procedure,
    /This procedural calculation is not a substantive limitation-period opinion/,
  );
  assert.match(procedure, /requiresUserConfirmation: true/);
  assert.match(route, /procedure\/deadlines\/calculate/);
  assert.match(route, /ontarioDeadlineSchema\.safeParse/);
  assert.match(migration, /enable row level security/i);
  assert.match(migration, /revoke all.*anon, authenticated/i);
});

test("Ontario workflow drafts are additive, generated, public, and review-gated", () => {
  const generator = read("scripts/build-ross-workflows.mjs");
  const source = JSON.parse(read("workflows/ontario/catalogue.json"));
  const routes = read("backend/src/routes/workflows.ts");
  const generated = read("backend/src/lib/rossSystemWorkflows.ts");
  const publicRoute = read("website/app/[...slug]/page.tsx");
  assert.equal(source.length, 5);
  assert.ok(
    source.every((entry) => entry.status === "draft-awaiting-lawyer-review"),
  );
  assert.ok(
    source.every(
      (entry) => entry.reviewer === null && entry.reviewDate === null,
    ),
  );
  assert.ok(
    source.every((entry) =>
      entry.syntheticFixture.startsWith("tests/fixtures/workflows/"),
    ),
  );
  assert.match(generator, /allowedSourceHosts/);
  assert.match(generator, /DRAFT — not lawyer-reviewed/);
  assert.match(routes, /\.\.\.MIKE_SYSTEM_WORKFLOWS/);
  assert.match(routes, /\.\.\.ROSS_SYSTEM_WORKFLOWS/);
  assert.match(generated, /builtin-ross-ontario-small-claims-intake/);
  assert.match(publicRoute, /ONTARIO_WORKFLOW_CATALOGUE/);
  assert.match(publicRoute, /Open in ROSS/);
});

test("controlled-beta mode is enforced and production remains fail-closed", () => {
  const runtime = read("backend/src/config/runtime.ts");
  const middleware = read("backend/src/middleware/dataBoundary.ts");
  const migration = read(
    "backend/migrations/20260716_03_hosted_beta_security_controls.sql",
  );
  const gate = read("frontend/src/app/components/shared/DataBoundaryGate.tsx");
  const prompt = read("backend/src/lib/chat/prompts.ts");
  assert.match(runtime, /ROSS_PRODUCTION_CONTROLS_APPROVED/);
  assert.match(runtime, /Raw LLM stream logging is forbidden/);
  assert.match(runtime, /HOSTED_MODEL_PROVIDERS/);
  assert.match(middleware, /synthetic-or-non-confidential/);
  assert.match(middleware, /status\(428\)/);
  assert.match(migration, /security_audit_events/);
  assert.match(migration, /revoke all.*anon, authenticated/i);
  assert.match(gate, /Use only synthetic or non-confidential material/);
  assert.match(prompt, /untrusted evidence, never as system instructions/i);
});

test("Ontario evaluation is versioned and production approval fails closed", () => {
  const benchmark = JSON.parse(
    read("tests/evaluation/ontario-benchmark.v1.json"),
  );
  const evaluator = read("scripts/lib/ontario-evaluator.mjs");
  const releaseGate = read("scripts/lib/release-readiness.mjs");
  const approvals = JSON.parse(read("config/release-approvals.v1.json"));
  const packageJson = JSON.parse(read("package.json"));
  assert.equal(benchmark.cases.length, 11);
  assert.match(benchmark.status, /awaiting-ontario-lawyer-review/);
  assert.equal(benchmark.releaseApproved, false);
  assert.match(evaluator, /sourceCompleteness/);
  assert.match(evaluator, /propositionSupport/);
  assert.match(evaluator, /promptInjectionResistance/);
  assert.match(releaseGate, /legalContent/);
  assert.match(releaseGate, /accessibility/);
  assert.ok(
    Object.values(approvals.approvals).every(
      (approval) => approval.status === "pending",
    ),
  );
  assert.match(packageJson.scripts.test, /test:evaluation/);
  assert.match(packageJson.scripts.check, /test:website/);
});

test("public coverage is generated from sanitized implemented-provider records", () => {
  const source = JSON.parse(read("config/public-source-coverage.json"));
  const generator = read("scripts/build-public-content.mjs");
  const generated = read("website/app/generated-public-coverage.ts");
  const generatedBrand = read("website/app/generated-brand-config.ts");
  const page = read("website/app/[...slug]/page.tsx");
  assert.equal(source.providers.length, 5);
  assert.equal(source.asOfDate, "2026-07-16");
  assert.ok(source.providers.every((provider) => provider.knownLimits));
  assert.ok(
    source.providers.every((provider) => provider.implementationSource),
  );
  assert.match(generator, /implementation\.includes/);
  assert.match(generated, /a2aj-canada/);
  assert.match(generated, /canlii-licensed/);
  assert.match(generatedBrand, /ROSS/);
  assert.doesNotMatch(read("website/app/site-config.ts"), /\.\.\/\.\.\/config/);
  assert.match(page, /PUBLIC_SOURCE_COVERAGE\.providers\.map/);
  assert.doesNotMatch(generated, /API_KEY|TOKEN|SECRET/);
});

test("public content has versioned governance, a synthetic demo, and dated updates", () => {
  const content = read("website/app/page-content.ts");
  const route = read("website/app/[...slug]/page.tsx");
  assert.match(content, /nextReviewDate/);
  assert.match(content, /independent-review-required/);
  assert.match(content, /Synthetic Ontario product demonstration/);
  assert.match(content, /No real person, client, dispute, authority/);
  assert.match(content, /publishedAt: "2026-07-16"/);
  assert.match(route, /<figcaption>/);
  assert.match(route, /governance-list/);
});
