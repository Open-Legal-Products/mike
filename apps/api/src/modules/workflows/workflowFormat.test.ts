// Guards the single-source-of-truth contract for the .mikeworkflow.json
// format: the zod schema in workflowFormat.ts is the definition, the
// published schemas/workflow.schema.json is generated from it, and this test
// fails whenever the two disagree — so the published contract can never
// drift from what the import endpoint actually enforces.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildWorkflowPackJsonSchema,
  describeWorkflowPackIssues,
  workflowPackSchema,
} from "./workflowFormat";

const publishedSchemaPath = resolve(
  __dirname,
  "../../../../../schemas/workflow.schema.json",
);

describe("workflow pack schema — drift check", () => {
  it("schemas/workflow.schema.json matches the zod source of truth", () => {
    const published = JSON.parse(readFileSync(publishedSchemaPath, "utf8"));
    // Deep equality, not just key presence: any change to the zod schema
    // must be accompanied by `npm run generate:workflow-schema`.
    expect(published).toEqual(buildWorkflowPackJsonSchema());
  });

  it("the published examples validate against the schema they document", () => {
    const examples = buildWorkflowPackJsonSchema().examples as unknown[];
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      const result = workflowPackSchema.safeParse(example);
      expect(
        result.success,
        result.success ? "" : describeWorkflowPackIssues(result.error),
      ).toBe(true);
    }
  });
});

describe("workflow pack schema — validation behavior", () => {
  const validPack = {
    formatVersion: 1,
    workflow: { title: "NDA Review", type: "assistant" },
  };

  it("accepts a minimal valid pack", () => {
    expect(workflowPackSchema.safeParse(validPack).success).toBe(true);
  });

  it("rejects a wrong formatVersion", () => {
    const result = workflowPackSchema.safeParse({
      ...validPack,
      formatVersion: 2,
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown workflow type", () => {
    const result = workflowPackSchema.safeParse({
      formatVersion: 1,
      workflow: { title: "x", type: "spreadsheet" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys (additionalProperties: false)", () => {
    const result = workflowPackSchema.safeParse({
      ...validPack,
      injected: "payload",
    });
    expect(result.success).toBe(false);
  });

  it("allows extra keys inside a column (forward compatibility)", () => {
    const result = workflowPackSchema.safeParse({
      formatVersion: 1,
      workflow: {
        title: "Risk Matrix",
        type: "tabular",
        columns_config: [
          { name: "Law", prompt: "Which law governs?", future_field: 42 },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a column missing its prompt", () => {
    const result = workflowPackSchema.safeParse({
      formatVersion: 1,
      workflow: {
        title: "Risk Matrix",
        type: "tabular",
        columns_config: [{ name: "Law" }],
      },
    });
    expect(result.success).toBe(false);
  });

  it("describeWorkflowPackIssues names the offending path", () => {
    const result = workflowPackSchema.safeParse({
      formatVersion: 1,
      workflow: { title: "", type: "assistant" },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(describeWorkflowPackIssues(result.error)).toContain(
        "workflow.title",
      );
    }
  });
});
