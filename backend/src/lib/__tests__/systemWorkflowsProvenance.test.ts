import { describe, expect, it, vi } from "vitest";
import {
  SYSTEM_WORKFLOW_IDS,
  SYSTEM_WORKFLOWS_SOURCE_COMMIT,
} from "../systemWorkflows";
import { DEFAULT_WORKFLOW_IDS } from "../workflowCatalog";

vi.mock("../storage", () => ({
  storageEnabled: false,
  uploadFile: vi.fn(),
}));

describe("generated system workflows provenance", () => {
  it("records the full mike-workflows source commit", () => {
    expect(SYSTEM_WORKFLOWS_SOURCE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
  });

  it("ships every hardcoded default workflow in the generated catalog", () => {
    for (const id of DEFAULT_WORKFLOW_IDS) {
      expect(SYSTEM_WORKFLOW_IDS.has(id)).toBe(true);
    }
  });
});
