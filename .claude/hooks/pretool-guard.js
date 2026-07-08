#!/usr/bin/env node
// PreToolUse guard (BUILD_PLAN §6.2): refuse Edit/Write to protected paths.
// Exit 2 blocks the tool call and feeds stderr back to the agent.
"use strict";
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

function authorizedMigrations() {
  // Human-maintained allowlist = the "explicit human instruction naming the file"
  // required by CLAUDE.md hard rule 1. Agents must never edit the allowlist itself.
  const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const p = path.join(root, ".claude", "hooks", "authorized-migrations.json");
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")).authorized || [];
  } catch {
    return [];
  }
}

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.exit(0); // malformed input — don't block
  }
  const ti = input.tool_input || {};
  const paths = [ti.file_path, ti.notebook_path].filter(Boolean);
  for (const p of paths) {
    const norm = String(p).replace(/\\/g, "/");
    const base = norm.split("/").pop() || "";

    if (/(^|\/)migrations\//.test(norm)) {
      if (!authorizedMigrations().includes(base)) {
        deny(`${p}: files under migrations/ must never be edited without an explicit human instruction naming the file (CLAUDE.md hard rule 1). Human-authorised files are listed in .claude/hooks/authorized-migrations.json.`);
      }
    }
    if (base === "authorized-migrations.json") {
      deny(`${p}: the migration allowlist is human-maintained — agents must not edit it (CLAUDE.md hard rule 1).`);
    }
    if (/^\.env($|\.)/.test(base) && !base.endsWith(".example")) {
      deny(`${p}: .env files must never be edited or created; document new vars in .env.example instead (CLAUDE.md hard rule 2).`);
    }
    if (/^LICEN[SC]E/i.test(base)) {
      deny(`${p}: LICENSE/licence files must never be modified — this fork stays AGPL-3.0 (CLAUDE.md hard rule 3).`);
    }
  }
  process.exit(0);
});

function deny(reason) {
  process.stderr.write(`BLOCKED: ${reason}\n`);
  process.exit(2);
}
