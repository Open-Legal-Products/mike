import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKFLOW_IDS,
  defaultWorkflowPayloads,
  workflowAddonSeeds,
} from "../workflowCatalog";
import { SYSTEM_WORKFLOWS } from "../systemWorkflows";

describe("workflow catalog", () => {
  it("installs the five starter workflows with linked quick-action settings", () => {
    const defaults = defaultWorkflowPayloads();
    expect(defaults).toHaveLength(5);
    expect(defaults.map((item) => `builtin-${item.default_key}`)).toEqual(
      DEFAULT_WORKFLOW_IDS,
    );
    expect(defaults.every((item) => item.quick_action_prompt.length > 0)).toBe(
      true,
    );
    expect(defaults.every((item) => item.document_upload)).toBe(true);
    expect(defaults).toContainEqual(
      expect.objectContaining({
        default_key: "commercial-agreement-tabular-review",
        type: "tabular",
      }),
    );
  });

  it("offers every non-default repository workflow as an add-on", () => {
    const seeds = workflowAddonSeeds();
    expect(seeds).toHaveLength(
      SYSTEM_WORKFLOWS.length - DEFAULT_WORKFLOW_IDS.length,
    );
    expect(seeds.map((item) => item.addon_key)).not.toContain("proofread");
    expect(seeds.map((item) => item.addon_key)).not.toContain(
      "commercial-agreement-tabular-review",
    );
    expect(seeds.map((item) => item.addon_key)).toContain(
      "design-partner-draft",
    );
  });

  it("embeds bundled add-on reference files for catalog synchronization", () => {
    const workflow = SYSTEM_WORKFLOWS.find(
      (item) => item.id === "builtin-design-partner-draft",
    );
    expect(workflow?.reference_files).toEqual([
      expect.objectContaining({
        filename: "template.docx",
        file_type: "docx",
      }),
    ]);
    expect(workflow?.reference_files[0]?.content_base64.length).toBeGreaterThan(
      100,
    );
  });

  it("preserves repository packs as category-qualified catalog folders", () => {
    const seeds = workflowAddonSeeds();
    expect(seeds.find((item) => item.addon_key === "einstieg-routing")).toEqual(
      expect.objectContaining({
        pack_key: "assistant:german-liquidity-planning",
        pack_title: "German Liquidity Planning Pack",
      }),
    );
    expect(
      seeds.find(
        (item) =>
          item.addon_key === "finnish-employment-contract-tabular-review",
      )?.pack_key,
    ).toBe("tabular:finnish-law");
    expect(
      seeds.find((item) => item.addon_key === "administrative-decision")
        ?.pack_key,
    ).toBe("assistant:finnish-law");
    expect(
      seeds.find((item) => item.addon_key === "design-partner-draft")?.pack_key,
    ).toBeNull();
  });
});
