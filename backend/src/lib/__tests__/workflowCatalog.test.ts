import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKFLOW_IDS,
  defaultWorkflowPayloads,
  ensureDefaultWorkflows,
  resetCatalogSyncForTests,
  resetEnsuredDefaultUsersForTests,
  syncWorkflowAddonCatalog,
  workflowAddonSeeds,
} from "../workflowCatalog";
import { SYSTEM_WORKFLOWS } from "../systemWorkflows";

vi.mock("../storage", () => ({
  storageEnabled: false,
  uploadFile: vi.fn(),
}));

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

describe("ensureDefaultWorkflows request-path cost", () => {
  beforeEach(() => resetEnsuredDefaultUsersForTests());

  it("calls the install RPC once per user per process", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: 5, error: null });
    const db = { rpc } as never;
    await expect(ensureDefaultWorkflows("user-1", db)).resolves.toBe(5);
    await expect(ensureDefaultWorkflows("user-1", db)).resolves.toBe(0);
    expect(rpc).toHaveBeenCalledTimes(1);
    await ensureDefaultWorkflows("user-2", db);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("retries after a failed install instead of caching the failure", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: new Error("db down") })
      .mockResolvedValue({ data: 5, error: null });
    const db = { rpc } as never;
    await expect(ensureDefaultWorkflows("user-1", db)).rejects.toThrow(
      "db down",
    );
    await expect(ensureDefaultWorkflows("user-1", db)).resolves.toBe(5);
    expect(rpc).toHaveBeenCalledTimes(2);
  });
});

describe("syncWorkflowAddonCatalog steady state", () => {
  beforeEach(() => resetCatalogSyncForTests());

  function makeDb(existingRows: unknown[]) {
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const update = vi.fn(() => ({
      in: vi.fn().mockResolvedValue({ error: null }),
    }));
    const select = vi.fn().mockResolvedValue({
      data: existingRows,
      error: null,
    });
    const from = vi.fn(() => ({ select, upsert, update }));
    return { db: { from } as never, from, select, upsert };
  }

  it("skips the upsert when every stored content hash already matches", async () => {
    const existing = workflowAddonSeeds().map((seed, index) => ({
      id: `row-${index}`,
      addon_key: seed.addon_key,
      content_hash: seed.content_hash,
      active: true,
    }));
    const { db, upsert } = makeDb(existing);
    await syncWorkflowAddonCatalog(db);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("runs one sync per process and shares it across concurrent callers", async () => {
    const { db, select } = makeDb([]);
    await Promise.all([
      syncWorkflowAddonCatalog(db),
      syncWorkflowAddonCatalog(db),
      syncWorkflowAddonCatalog(db),
    ]);
    await syncWorkflowAddonCatalog(db);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("clears the latch after a failure so the next request retries", async () => {
    const failing = {
      from: vi.fn(() => ({
        select: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error("boom") }),
      })),
    } as never;
    await expect(syncWorkflowAddonCatalog(failing)).rejects.toThrow("boom");
    const { db, select } = makeDb([]);
    await syncWorkflowAddonCatalog(db);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
