import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const routesDir = join(process.cwd(), "src", "routes");
const indexDir = join(process.cwd(), "src");

/** Read all .ts files in the routes directory. */
function readRouteFiles(): Array<{ name: string; content: string }> {
  const files = readdirSync(routesDir).filter((f) => f.endsWith(".ts"));
  return files.map((name) => ({
    name,
    content: readFileSync(join(routesDir, name), "utf-8"),
  }));
}

/**
 * Routes that are intentionally public (no requireAuth).
 * These are legitimate exceptions — e.g. OAuth callbacks that handle
 * the redirect from an external provider before the user is authenticated.
 */
const PUBLIC_ROUTE_PATTERNS: Array<{ file: string; path: string }> = [
  { file: "user.ts", path: "/mcp-connectors/oauth/callback" },
];

/** Check if a route definition in a file is an intentionally public route. */
function isIntentionallyPublic(fileName: string, content: string, lineNum: number): boolean {
  for (const { file, path } of PUBLIC_ROUTE_PATTERNS) {
    if (file !== fileName) continue;
    // Check if the route definition near this line contains the public path
    const nearby = content.slice(
      Math.max(0, content.lastIndexOf("\n", lineNum)),
      content.indexOf("\n", lineNum + 200),
    );
    if (nearby.includes(path)) return true;
  }
  return false;
}

/** Count route definitions (router.get/post/put/patch/delete) in a file,
 *  excluding intentionally public routes. */
function countRouteDefinitions(content: string): number {
  const matches = content.match(
    /\w+(?:Router|router)\.(get|post|put|patch|delete)\s*\(/g,
  );
  return matches ? matches.length : 0;
}

/** Check if file applies requireAuth at the router level. */
function hasRouterLevelAuth(content: string): boolean {
  return /\w+(?:Router|router)\.use\s*\(\s*requireAuth/.test(content);
}

/** Count requireAuth usages excluding the import line. */
function countRequireAuthUsages(content: string): number {
  const total = (content.match(/requireAuth/g) || []).length;
  // Subtract import occurrences (typically 1)
  const importMatches = content.match(
    /import\s*\{[^}]*requireAuth[^}]*\}\s*from\s*["'][^"']*auth["']/g,
  );
  const importCount = importMatches ? importMatches.length : 0;
  return total - importCount;
}

describe("route security classification", () => {
  const routeFiles = readRouteFiles();

  it("should find route files in src/routes/", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
    const names = routeFiles.map((f) => f.name);
    expect(names).toContain("caseLaw.ts");
    expect(names).toContain("chat.ts");
    expect(names).toContain("documents.ts");
    expect(names).toContain("downloads.ts");
    expect(names).toContain("projects.ts");
    expect(names).toContain("tabular.ts");
    expect(names).toContain("user.ts");
    expect(names).toContain("workflows.ts");
  });

  // -----------------------------------------------------------------------
  // Every route file imports / uses requireAuth
  // -----------------------------------------------------------------------

  it.each(routeFiles.map((f) => [f.name, f.content] as const))(
    "%s should import or use requireAuth",
    (_name, content) => {
      expect(content).toContain("requireAuth");
    },
  );

  // -----------------------------------------------------------------------
  // No route file should define routes without requireAuth protection
  // -----------------------------------------------------------------------

  it.each(routeFiles.map((f) => [f.name, f.content] as const))(
    "%s — every route should be protected by requireAuth (router-level or per-route)",
    (name, content) => {
      const routeCount = countRouteDefinitions(content);
      const routerLevel = hasRouterLevelAuth(content);

      if (routerLevel) {
        // Router-level auth covers all routes — sufficient.
        return;
      }

      // OAuth callback routes are exempt: they receive redirects from
      // external providers and verify identity via encrypted state params.
      const exemptPatterns = ["/oauth/callback"];
      const exemptCount = exemptPatterns.filter((p) =>
        content.includes(p),
      ).length;
      const usageCount = countRequireAuthUsages(content);
      expect(
        usageCount + exemptCount >= routeCount,
        `${name}: ${usageCount} requireAuth usages + ${exemptCount} OAuth exemptions for ${routeCount} route definitions`,
      ).toBe(true);
    },
  );

  // -----------------------------------------------------------------------
  // caseLawRouter uses requireAuth at the router level
  // -----------------------------------------------------------------------

  it("caseLaw.ts should apply requireAuth at the router level", () => {
    const caseLaw = routeFiles.find((f) => f.name === "caseLaw.ts");
    expect(caseLaw).toBeDefined();
    expect(hasRouterLevelAuth(caseLaw!.content)).toBe(true);
    expect(caseLaw!.content).toMatch(/caseLawRouter\.use\s*\(\s*requireAuth\s*\)/);
  });

  // -----------------------------------------------------------------------
  // /health and /ready in index.ts do NOT use requireAuth
  // -----------------------------------------------------------------------

  it("index.ts /health endpoint should NOT use requireAuth (intentionally public)", () => {
    const indexContent = readFileSync(join(indexDir, "index.ts"), "utf-8");
    // Extract the /health route handler
    const healthMatch = indexContent.match(
      /app\.(get)\s*\(\s*["']\/health["'][\s\S]*?\)\s*;/,
    );
    expect(healthMatch).not.toBeNull();
    expect(healthMatch![0]).not.toContain("requireAuth");
  });

  it("index.ts /ready endpoint should NOT use requireAuth (intentionally public)", () => {
    const indexContent = readFileSync(join(indexDir, "index.ts"), "utf-8");
    // Extract the /ready route handler
    const readyMatch = indexContent.match(
      /app\.(get)\s*\(\s*["']\/ready["'][\s\S]*?\)\s*;/,
    );
    expect(readyMatch).not.toBeNull();
    expect(readyMatch![0]).not.toContain("requireAuth");
  });

  // -----------------------------------------------------------------------
  // No route file should be completely missing requireAuth
  // -----------------------------------------------------------------------

  it("no route file should lack requireAuth entirely", () => {
    for (const { name, content } of routeFiles) {
      const usages = countRequireAuthUsages(content);
      expect(usages, `${name} should have at least one requireAuth usage`).toBeGreaterThan(0);
    }
  });

  // -----------------------------------------------------------------------
  // Verify specific known routes are protected
  // -----------------------------------------------------------------------

  it("chat.ts routes should all use requireAuth", () => {
    const chat = routeFiles.find((f) => f.name === "chat.ts");
    expect(chat).toBeDefined();
    const routeCount = countRouteDefinitions(chat!.content);
    const usageCount = countRequireAuthUsages(chat!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("projects.ts routes should all use requireAuth", () => {
    const projects = routeFiles.find((f) => f.name === "projects.ts");
    expect(projects).toBeDefined();
    const routeCount = countRouteDefinitions(projects!.content);
    const usageCount = countRequireAuthUsages(projects!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("documents.ts routes should all use requireAuth", () => {
    const docs = routeFiles.find((f) => f.name === "documents.ts");
    expect(docs).toBeDefined();
    const routeCount = countRouteDefinitions(docs!.content);
    const usageCount = countRequireAuthUsages(docs!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("tabular.ts routes should all use requireAuth", () => {
    const tabular = routeFiles.find((f) => f.name === "tabular.ts");
    expect(tabular).toBeDefined();
    const routeCount = countRouteDefinitions(tabular!.content);
    const usageCount = countRequireAuthUsages(tabular!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("user.ts routes should all use requireAuth (except OAuth callback)", () => {
    const user = routeFiles.find((f) => f.name === "user.ts");
    expect(user).toBeDefined();
    const routeCount = countRouteDefinitions(user!.content);
    // OAuth callback is exempt — it receives external redirects and verifies
    // identity via encrypted state parameters created during oauth/start.
    const exemptCount = user!.content.includes("/oauth/callback") ? 1 : 0;
    const usageCount = countRequireAuthUsages(user!.content);
    expect(usageCount + exemptCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("workflows.ts routes should all use requireAuth", () => {
    const workflows = routeFiles.find((f) => f.name === "workflows.ts");
    expect(workflows).toBeDefined();
    const routeCount = countRouteDefinitions(workflows!.content);
    const usageCount = countRequireAuthUsages(workflows!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("downloads.ts routes should all use requireAuth", () => {
    const downloads = routeFiles.find((f) => f.name === "downloads.ts");
    expect(downloads).toBeDefined();
    const routeCount = countRouteDefinitions(downloads!.content);
    const usageCount = countRequireAuthUsages(downloads!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });

  it("projectChat.ts routes should all use requireAuth", () => {
    const projectChat = routeFiles.find((f) => f.name === "projectChat.ts");
    expect(projectChat).toBeDefined();
    const routeCount = countRouteDefinitions(projectChat!.content);
    const usageCount = countRequireAuthUsages(projectChat!.content);
    expect(usageCount).toBeGreaterThanOrEqual(routeCount);
  });
});
