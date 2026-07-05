// Regenerates schemas/workflow.schema.json from the zod schema in
// src/modules/workflows/workflowFormat.ts — the single source of truth for
// the .mikeworkflow.json format.
//
// Run from apps/api:  npm run generate:workflow-schema
//
// The drift test (workflowFormat.test.ts) fails CI whenever the committed
// file differs from what this script would write, so a format change is
// always a two-file commit: the zod schema and the regenerated JSON.

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildWorkflowPackJsonSchema } from "../src/modules/workflows/workflowFormat";

const outPath = resolve(__dirname, "../../../schemas/workflow.schema.json");
const json = `${JSON.stringify(buildWorkflowPackJsonSchema(), null, 2)}\n`;

writeFileSync(outPath, json);
console.log(`wrote ${outPath}`);
