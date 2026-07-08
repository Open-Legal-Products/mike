/**
 * Golden-set eval runner (BUILD_PLAN §4).
 *
 *   npm run evals          — full suite (CI merge gate; citation hard gate included)
 *   npm run evals:smoke    — cases tagged `smoke: true` (max 5; used by the Stop hook)
 *
 * Exit code 0 only when no case fails. Pending/skipped cases are reported loudly
 * but do not fail the suite (the golden set is populated during the sprint).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import type { CaseResult, EvalCase } from "./types.js";
import { resolveCitations } from "./citations.js";
import { judge } from "./judge.js";

const EVALS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const CASES_DIR = join(EVALS_DIR, "cases");
const BASELINE_PATH = join(EVALS_DIR, "baseline.json");
const SMOKE_LIMIT = 5;

function loadCases(): EvalCase[] {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR)
    .filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"))
    .sort()
    .map((f) => {
      const c = yaml.load(readFileSync(join(CASES_DIR, f), "utf8")) as EvalCase;
      if (!c?.id || !c?.type) throw new Error(`invalid case file ${f}: id and type are required`);
      return c;
    });
}

async function runDeterministic(c: EvalCase): Promise<CaseResult> {
  const req = c.request;
  if (!req) return { id: c.id, type: c.type, status: "fail", detail: "deterministic case has no request" };

  const headers: Record<string, string> = { "User-Agent": "JessicaOS-evals/0.1" };
  if (req.auth === "companies_house") {
    const key = process.env.COMPANIES_HOUSE_API_KEY;
    if (!key) {
      return { id: c.id, type: c.type, status: "skip", detail: "COMPANIES_HOUSE_API_KEY not set" };
    }
    headers.Authorization = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
  }

  const res = await fetch(req.url, { headers });
  const expectedStatus = req.status ?? 200;
  if (res.status !== expectedStatus) {
    return { id: c.id, type: c.type, status: "fail", detail: `HTTP ${res.status}, expected ${expectedStatus}` };
  }
  const body = await res.text();
  const missing = (req.contains ?? []).filter((s) => !body.includes(s));
  if (missing.length > 0) {
    return { id: c.id, type: c.type, status: "fail", detail: `response missing: ${missing.map((m) => JSON.stringify(m)).join(", ")}` };
  }
  return { id: c.id, type: c.type, status: "pass", detail: `HTTP ${res.status}, ${req.contains?.length ?? 0} assertion(s)` };
}

async function runCitation(c: EvalCase): Promise<CaseResult> {
  const text = c.input?.text;
  if (!text) return { id: c.id, type: c.type, status: "fail", detail: "citation case has no input.text" };
  const { citations, failures } = await resolveCitations(text);
  if (citations.length === 0) {
    return { id: c.id, type: c.type, status: "fail", detail: "no citations found in input — a citation case must exercise the extractor" };
  }
  if (failures.length > 0) {
    return {
      id: c.id,
      type: c.type,
      status: "fail",
      detail: failures.map((f) => `${f.citation.raw}: ${f.reason}`).join(" | "),
    };
  }
  return { id: c.id, type: c.type, status: "pass", detail: `${citations.length} citation(s) resolved via live API` };
}

async function runJudged(c: EvalCase): Promise<CaseResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { id: c.id, type: c.type, status: "skip", detail: "ANTHROPIC_API_KEY not set — judged cases require it (CI must set it)" };
  }
  if (!c.input?.text || !c.rubric) {
    return { id: c.id, type: c.type, status: "fail", detail: "judged case needs input.text and rubric" };
  }
  const verdict = await judge({ output: c.input.text, rubricPath: c.rubric, evalsDir: EVALS_DIR });
  const min = c.min_score ?? 3;
  const status = verdict.score >= min ? "pass" : "fail";
  return {
    id: c.id,
    type: c.type,
    status,
    score: verdict.score,
    detail: `score ${verdict.score}/5 (min ${min})${verdict.failures.length ? ` — ${verdict.failures.join("; ")}` : ""}`,
  };
}

async function runCase(c: EvalCase): Promise<CaseResult> {
  if (c.pending) return { id: c.id, type: c.type, status: "pending", detail: c.pending };

  let result: CaseResult;
  try {
    result =
      c.type === "deterministic" ? await runDeterministic(c)
      : c.type === "citation" ? await runCitation(c)
      : await runJudged(c);
  } catch (err) {
    result = { id: c.id, type: c.type, status: "fail", detail: `error: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (c.expect_failure && (result.status === "pass" || result.status === "fail")) {
    const inverted = result.status === "fail" ? "pass" : "fail";
    result = { ...result, status: inverted, detail: `[expect_failure] ${result.detail}` };
  }
  return result;
}

function checkBaseline(results: CaseResult[]): string | null {
  if (!existsSync(BASELINE_PATH)) return null;
  const scored = results.filter((r) => r.score !== undefined);
  if (scored.length === 0) return null;
  const mean = scored.reduce((a, r) => a + (r.score ?? 0), 0) / scored.length;
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as { meanJudgedScore: number };
  if (mean + 1e-9 < baseline.meanJudgedScore) {
    return `judged mean ${mean.toFixed(2)} regressed below baseline ${baseline.meanJudgedScore.toFixed(2)}`;
  }
  return null;
}

async function main() {
  const smoke = process.argv.includes("--smoke");
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx > -1 ? process.argv[onlyIdx + 1] : undefined;

  let cases = loadCases();
  if (only) cases = cases.filter((c) => c.id === only);
  if (smoke) {
    const tagged = cases.filter((c) => c.smoke);
    if (tagged.length > SMOKE_LIMIT) {
      console.warn(`warning: ${tagged.length} cases tagged smoke — only the first ${SMOKE_LIMIT} run`);
    }
    cases = tagged.slice(0, SMOKE_LIMIT);
  }

  if (cases.length === 0) {
    console.error("no eval cases found — refusing to report a vacuous pass");
    process.exit(1);
  }

  console.log(`Running ${cases.length} case(s)${smoke ? " [smoke]" : ""}\n`);
  const results: CaseResult[] = [];
  for (const c of cases) {
    const r = await runCase(c);
    results.push(r);
    const icon = { pass: "✅", fail: "❌", skip: "⏭️ ", pending: "🕓" }[r.status];
    console.log(`${icon} ${r.id} [${r.type}] — ${r.detail}`);
  }

  const counts = { pass: 0, fail: 0, skip: 0, pending: 0 };
  for (const r of results) counts[r.status]++;
  const regression = checkBaseline(results);

  console.log(
    `\n${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped, ${counts.pending} pending`,
  );
  if (regression) console.error(`❌ ${regression}`);

  process.exit(counts.fail > 0 || regression ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
