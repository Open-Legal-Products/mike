// Single source of truth for the .mikeworkflow.json interchange format.
//
// The zod schema below is THE definition of the format. Everything else is
// derived from it:
//   - `importWorkflow` (workflows.service.ts) validates uploads with it, so
//     the API can never accept a file the published schema rejects.
//   - `schemas/workflow.schema.json` (the schema we publish for external
//     tooling) is GENERATED from it via `npm run generate:workflow-schema`
//     in apps/api. Never edit that file by hand.
//   - A drift test (workflowFormat.test.ts) fails CI if the generated file
//     and this schema ever disagree, so the two cannot drift apart silently.
//
// If you change the format: edit this file, run the generator, and commit
// both files together. Breaking changes must bump WORKFLOW_PACK_FORMAT_VERSION.

import { z } from "zod";

export const WORKFLOW_PACK_FORMAT_VERSION = 1;

const columnConfigSchema = z
  .looseObject({
    name: z.string().describe("Column heading shown in the UI."),
    prompt: z
      .string()
      .describe("The prompt sent to the LLM for each cell in this column."),
    type: z
      .enum(["text", "flag", "yesno"])
      .optional()
      .describe(
        "Optional cell rendering hint. 'flag' renders a coloured badge; 'yesno' renders Yes/No; 'text' (default) renders plain text.",
      ),
  })
  .describe(
    "One column definition in a 'tabular' workflow's review table. Extra keys are allowed so newer exports keep importing into older deployments.",
  );

export const workflowPackSchema = z.strictObject({
  formatVersion: z
    .literal(WORKFLOW_PACK_FORMAT_VERSION)
    .describe(
      "Schema version. Always 1 for files produced by the current export endpoint. Future breaking changes will increment this value.",
    ),
  exportedAt: z.iso
    .datetime()
    .optional()
    .describe(
      "ISO 8601 timestamp of when the file was exported. Informational only — not used during import.",
    ),
  workflow: z.strictObject({
    title: z
      .string()
      .min(1)
      .max(255)
      .describe("Human-readable name shown in the workflow picker."),
    type: z
      .enum(["assistant", "tabular"])
      .describe(
        "Determines where the workflow appears. 'assistant' workflows appear in the chat sidebar; 'tabular' workflows appear in the tabular review column picker.",
      ),
    prompt_md: z
      .string()
      .nullable()
      .optional()
      .describe(
        "The full workflow prompt in Markdown. For 'assistant' workflows, this is injected into the system prompt when the workflow is activated. For 'tabular' workflows, this describes the analysis task for each cell.",
      ),
    columns_config: z
      .array(columnConfigSchema)
      .nullable()
      .optional()
      .describe(
        "Column definitions for 'tabular' workflows. Each entry defines one column in the review table. Null for 'assistant' workflows.",
      ),
    practice: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Optional legal practice area tag (e.g. 'corporate', 'ip', 'employment'). Used for filtering in the workflow picker.",
      ),
  }),
});

export type WorkflowPack = z.infer<typeof workflowPackSchema>;

// Turns zod validation issues into the single human-readable `detail` string
// the import endpoint returns. Kept here so route/service code never needs to
// know zod's issue format.
export function describeWorkflowPackIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length ? issue.path.join(".") : "(root)";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

// Builds the exact JSON value published as schemas/workflow.schema.json.
// The zod schema converts to draft-07; the envelope ($id, title, examples)
// is metadata for external consumers and lives here so the generator and the
// drift test share one definition.
export function buildWorkflowPackJsonSchema(): Record<string, unknown> {
  const converted = z.toJSONSchema(workflowPackSchema, {
    target: "draft-7",
  }) as Record<string, unknown>;

  return {
    ...converted,
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: "https://github.com/willchen96/mike/schemas/workflow.schema.json",
    title: "Mike Workflow Pack",
    description:
      "Schema for .mikeworkflow.json files exported from and imported into Mike. GENERATED from apps/api/src/modules/workflows/workflowFormat.ts by `npm run generate:workflow-schema` — do not edit by hand. See docs/workflows.md for a full explanation of each field.",
    examples: [
      {
        formatVersion: 1,
        exportedAt: "2026-05-24T12:00:00.000Z",
        workflow: {
          title: "NDA Quick Review",
          type: "assistant",
          prompt_md:
            "Review the provided NDA and identify:\n1. Key definitions and their scope\n2. Exclusions from confidential information\n3. Duration of confidentiality obligations\n4. Any unusual or unfair clauses\n\nProvide a structured summary with a risk rating (Low / Medium / High).",
          columns_config: null,
          practice: "corporate",
        },
      },
      {
        formatVersion: 1,
        exportedAt: "2026-05-24T12:00:00.000Z",
        workflow: {
          title: "Contract Risk Matrix",
          type: "tabular",
          prompt_md: null,
          columns_config: [
            {
              name: "Governing Law",
              prompt:
                "What jurisdiction's law governs this agreement? Return only the jurisdiction name.",
              type: "text",
            },
            {
              name: "Liability Cap",
              prompt:
                "Is there a liability cap? If yes, state the amount or formula. If no, say 'None'.",
              type: "text",
            },
            {
              name: "Auto-Renewal",
              prompt: "Does this contract auto-renew? Answer Yes or No.",
              type: "yesno",
            },
            {
              name: "Red Flag",
              prompt:
                "Does this contract contain any clauses that are unusual, unfair, or potentially unenforceable? If yes, flag as RED and briefly explain. If no, flag as GREEN.",
              type: "flag",
            },
          ],
          practice: "corporate",
        },
      },
    ],
  };
}
