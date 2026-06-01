import { describe, it, expect } from "vitest";
import { BUILTIN_WORKFLOWS } from "../../src/lib/builtinWorkflows";
import { PORTED_LEGAL_WORKFLOWS } from "../../src/lib/portedLegalWorkflows";

describe("ported claude-for-legal workflows", () => {
  it("includes the promoted commercial review playbooks", () => {
    const ids = new Set(PORTED_LEGAL_WORKFLOWS.map((w) => w.id));
    for (const id of [
      "builtin-cfl-commercial-review",
      "builtin-cfl-commercial-nda-review",
      "builtin-cfl-commercial-vendor-agreement-review",
      "builtin-cfl-commercial-saas-msa-review",
    ]) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it("drops plugin-runtime / config-management skills", () => {
    const joined = PORTED_LEGAL_WORKFLOWS.map((w) => w.id).join(",");
    for (const dropped of [
      "cold-start-interview",
      "customize",
      "matter-workspace",
      "renewal-tracker",
      "review-proposals",
    ]) {
      expect(joined).not.toContain(dropped);
    }
  });

  it("adapts each body to Mike's Practice Profile + guardrail and drops upstream paths", () => {
    for (const wf of PORTED_LEGAL_WORKFLOWS) {
      expect(wf.prompt_md).toContain("USER PRACTICE PROFILE");
      expect(wf.prompt_md).toContain("draft for attorney review");
      // Upstream CLAUDE.md practice-profile paths must be rewritten away.
      expect(wf.prompt_md).not.toContain(".claude/plugins/config");
      expect(wf.prompt_md).not.toContain("CLAUDE.md");
    }
  });

  it("merges ported workflows into the injectable BUILTIN_WORKFLOWS", () => {
    const ids = new Set(BUILTIN_WORKFLOWS.map((w) => w.id));
    // hand-written ones still present
    expect(ids.has("builtin-cp-checklist")).toBe(true);
    // ported ones now injectable via read_workflow
    expect(ids.has("builtin-cfl-commercial-review")).toBe(true);
    expect(BUILTIN_WORKFLOWS.length).toBeGreaterThanOrEqual(
      PORTED_LEGAL_WORKFLOWS.length + 3,
    );
  });
});
