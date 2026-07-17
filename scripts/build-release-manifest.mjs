#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(
  readFileSync(resolve(root, "config/release-manifest.v1.json"), "utf8"),
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const artifacts = config.artifacts.map((path) => {
  const bytes = readFileSync(resolve(root, path));
  return { path, sha256: hash(bytes), sizeBytes: bytes.byteLength };
});
const report = {
  version: config.version,
  releaseId: config.releaseId,
  generatedAt: config.generatedAt,
  algorithm: "sha256",
  artifactCount: artifacts.length,
  artifacts,
};
const outputPath = resolve(root, "reports/release-manifest-v1.json");
const output = `${JSON.stringify(report, null, 2)}\n`;

if (process.argv.includes("--check")) {
  if (!existsSync(outputPath) || readFileSync(outputPath, "utf8") !== output) {
    console.error("Release manifest is missing or stale. Run npm run build:release-manifest.");
    process.exitCode = 1;
  } else {
    console.log(`PASS: release manifest covers ${artifacts.length} governed artifacts.`);
  }
} else {
  writeFileSync(outputPath, output);
  console.log(`Wrote reports/release-manifest-v1.json with ${artifacts.length} artifacts.`);
}
