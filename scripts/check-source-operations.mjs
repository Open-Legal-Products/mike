#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluateSourceOperations } from "./lib/source-operations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));
const result = evaluateSourceOperations(
  readJson("config/legal-source-operations.v1.json"),
  readJson("reports/legal-source-health-v1.json"),
);
const production = process.argv.includes("--production");

console.log(
  production
    ? `${result.ready ? "PASS" : "BLOCKED"}: legal-source operational gate.`
    : "PASS: legal-source operations policy validated; live production observations remain separate.",
);
for (const blocker of result.blockers) console.error(`- ${blocker}`);
if (production && !result.ready) process.exitCode = 1;
