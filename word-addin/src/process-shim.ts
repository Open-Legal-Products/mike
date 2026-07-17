/**
 * Browser `process` global shim — MUST be the first module in every entry.
 *
 * The task pane now consumes the shared @mike/api-client, whose module-eval-time
 * code reads `process?.env?.…` via optional chaining (e.g. its default API base
 * and NODE_ENV). webpack's EnvironmentPlugin only text-substitutes the specific
 * registered `process.env.KEY` member reads at build time; it does NOT create a
 * `process` global, so the bare `process` identifier in those optional-chaining
 * reads is undefined at runtime and throws "process is not defined", which
 * white-screens the pane before React mounts. Installing a minimal `process`
 * object here makes those reads resolve to `undefined` (→ their defaults)
 * instead of throwing. The add-in's own env is still baked in by
 * EnvironmentPlugin's build-time substitution and is unaffected by this shim.
 */
const g = globalThis as unknown as {
  process?: { env?: Record<string, unknown> };
};

if (typeof g.process === "undefined") {
  g.process = { env: {} };
} else if (typeof g.process.env === "undefined") {
  g.process.env = {};
}

// Seed NODE_ENV (EnvironmentPlugin replaces the RHS with the build-mode literal)
// so libraries reading it via optional chaining see the correct mode.
if (g.process.env && g.process.env.NODE_ENV == null) {
  g.process.env.NODE_ENV = process.env.NODE_ENV;
}

export {};
