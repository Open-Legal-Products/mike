#!/usr/bin/env node
// PostToolUse check (BUILD_PLAN §6.1): typecheck + lint + format on the project
// containing the edited file. Exit 2 blocks and feeds errors back to the agent.
"use strict";
const { execSync } = require("node:child_process");
const { existsSync } = require("node:fs");
const path = require("node:path");

function hasPrettierConfig(projDir) {
  const candidates = [
    ".prettierrc", ".prettierrc.json", ".prettierrc.js", ".prettierrc.cjs",
    ".prettierrc.yaml", ".prettierrc.yml", "prettier.config.js", "prettier.config.cjs",
  ];
  if (candidates.some((f) => existsSync(path.join(projDir, f)))) return true;
  try {
    return !!JSON.parse(require("node:fs").readFileSync(path.join(projDir, "package.json"), "utf8")).prettier;
  } catch {
    return false;
  }
}

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0);
  }
  const filePath = input.tool_input && input.tool_input.file_path;
  if (!filePath || !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(filePath)) process.exit(0);

  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const rel = path.relative(root, filePath).replace(/\\/g, "/");
  const project = rel.startsWith("backend/") ? "backend"
    : rel.startsWith("frontend/") ? "frontend"
    : rel.startsWith("evals/") ? "evals"
    : null;
  if (!project) process.exit(0);

  const projDir = path.join(root, project);
  if (!existsSync(path.join(projDir, "node_modules"))) {
    console.log(`posttool-check: ${project}/node_modules missing — run \`npm install\` there to enable checks (skipping).`);
    process.exit(0);
  }

  const failures = [];
  const run = (label, cmd) => {
    try {
      execSync(cmd, { cwd: projDir, stdio: "pipe", timeout: 110000 });
    } catch (err) {
      const out = [err.stdout, err.stderr].filter(Boolean).map(String).join("\n");
      failures.push(`--- ${label} failed ---\n${out.slice(0, 6000)}`);
    }
  };

  run("tsc --noEmit", "npx tsc --noEmit");
  if (project === "frontend") {
    run("eslint", `npx eslint ${JSON.stringify(path.relative(projDir, filePath))}`);
  }
  // Prettier only where the project actually configures it — this repo has no
  // prettier config, upstream files are not prettier-clean, and auto-formatting
  // them would violate minimal-diff discipline (CLAUDE.md hard rule 8).
  if (project === "backend" && hasPrettierConfig(projDir)) {
    run("prettier --check", `npx prettier --check ${JSON.stringify(path.relative(projDir, filePath))}`);
  }

  if (failures.length > 0) {
    process.stderr.write(`Checks failed for ${rel} — fix before continuing:\n${failures.join("\n")}\n`);
    process.exit(2);
  }
  process.exit(0);
});
