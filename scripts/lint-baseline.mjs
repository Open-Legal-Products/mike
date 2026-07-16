import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const frontend = resolve(root, "frontend");
const executable = resolve(
  frontend,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "eslint.cmd" : "eslint"
);
const baseline = JSON.parse(
  readFileSync(resolve(root, "tests/baseline/frontend-lint-debt.json"), "utf8")
);

const result = spawnSync(executable, [".", "--format", "json"], {
  cwd: frontend,
  encoding: "utf8",
  maxBuffer: 20 * 1024 * 1024
});

if (result.error) throw result.error;

let reports;
try {
  reports = JSON.parse(result.stdout);
} catch {
  process.stderr.write(result.stdout);
  process.stderr.write(result.stderr);
  throw new Error("ESLint did not return valid JSON output.");
}

const groups = {};
let errors = 0;
let warnings = 0;
for (const report of reports) {
  errors += report.errorCount;
  warnings += report.warningCount;
  const path = relative(frontend, report.filePath).replaceAll("\\", "/");
  for (const message of report.messages.filter((item) => item.severity === 2)) {
    const key = path + "::" + (message.ruleId || "(fatal)");
    groups[key] = (groups[key] || 0) + 1;
  }
}

const regressions = [];
if (errors > baseline.error_ceiling) {
  regressions.push("error count " + errors + " exceeds " + baseline.error_ceiling);
}
if (warnings > baseline.warning_ceiling) {
  regressions.push("warning count " + warnings + " exceeds " + baseline.warning_ceiling);
}
for (const [key, count] of Object.entries(groups)) {
  const allowed = baseline.allowed_error_groups[key] || 0;
  if (count > allowed) regressions.push(key + " has " + count + " errors; allowed " + allowed);
}

if (regressions.length) {
  console.error("Frontend lint baseline regressed:");
  for (const regression of regressions) console.error("- " + regression);
  console.error("Run npm run lint:strict for full details.");
  process.exit(1);
}

console.log(
  "Frontend lint baseline preserved: " + errors + " inherited errors, " + warnings + " warnings."
);
console.log("Run npm run lint:strict to inspect or reduce the inherited lint debt.");
