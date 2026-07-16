import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const json = (path) => JSON.parse(read(path));

test("the approved beta boundary is recorded", () => {
  const boundary = read("docs/product-boundary.md").replaceAll(/\s*>?\s+/g, " ");
  assert.match(boundary, /invitation-only web application/i);
  assert.match(boundary, /Ontario lawyers and paralegals/i);
  assert.match(boundary, /synthetic or non-confidential materials only/i);
  assert.match(boundary, /preserve all Mike functionality/i);
});

test("the inherited Mike baseline is pinned and additive", () => {
  const baseline = read("docs/mike-feature-baseline.yaml");
  assert.match(baseline, /ba02044812da7548103e24e7675fca1dec62310d/);
  assert.match(baseline, /mode: additive/);
  assert.match(baseline, /CourtListener/);
});

test("backend and frontend retain their inherited verification commands", () => {
  const backend = json("backend/package.json");
  const frontend = json("frontend/package.json");
  assert.equal(backend.scripts.build, "tsc");
  assert.equal(frontend.scripts.build, "next build");
  assert.equal(frontend.scripts.lint, "eslint");
});

test("the inherited API surfaces remain mounted", () => {
  const server = read("backend/src/index.ts");
  const routeFragments = [
    "/chat",
    "/projects",
    "/projects/:projectId/chat",
    "/single-documents",
    "/tabular-review",
    "/workflows",
    "/user",
    "/users",
    "/download",
    "/case-law",
    "/health"
  ];
  for (const route of routeFragments) {
    assert.match(server, new RegExp(route.replaceAll("/", "\\/")), route + " must remain mounted");
  }
});

test("the inherited application routes and components remain present", () => {
  const requiredPaths = [
    "frontend/src/app/(pages)/assistant/page.tsx",
    "frontend/src/app/(pages)/projects/page.tsx",
    "frontend/src/app/(pages)/projects/[id]/page.tsx",
    "frontend/src/app/(pages)/workflows/page.tsx",
    "frontend/src/app/(pages)/account/page.tsx",
    "frontend/src/app/components/assistant/ChatView.tsx",
    "frontend/src/app/components/assistant/DocPanel.tsx",
    "frontend/src/app/components/tabular/TabularReviewView.tsx"
  ];
  for (const path of requiredPaths) {
    assert.equal(existsSync(resolve(root, path)), true, path + " must remain present");
  }
});

test("CourtListener remains available while Ontario sources are added later", () => {
  const corpus = [
    read("backend/src/lib/chat/prompts.ts"),
    read("backend/src/lib/chat/tools/courtlistenerTools.ts"),
    read("frontend/src/app/(pages)/account/features/page.tsx")
  ].join("\n");
  assert.match(corpus, /CourtListener/i);
});

test("the inherited data model keeps its core tables", () => {
  const schema = read("backend/schema.sql");
  const tables = [
    "user_profiles",
    "projects",
    "project_subfolders",
    "documents",
    "document_versions",
    "document_edits",
    "workflows",
    "chats",
    "chat_messages",
    "tabular_reviews"
  ];
  for (const table of tables) {
    assert.match(schema, new RegExp(table), table + " must remain in the schema");
  }
});

test("baseline fixtures are explicitly synthetic", () => {
  const manifest = json("tests/fixtures/manifest.json");
  assert.equal(manifest.synthetic_only, true);
  assert.ok(manifest.files.length >= 2);
  for (const fixture of manifest.files) {
    const contents = read(fixture.path);
    assert.match(contents, /SYNTHETIC/i, fixture.path + " must be visibly labelled synthetic");
  }
});
