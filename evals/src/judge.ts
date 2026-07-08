/**
 * Opus judge wiring (BUILD_PLAN §4.3): scores workflow outputs 1–5 against a
 * per-workflow rubric. Structured JSON output is enforced via output_config
 * json_schema, so the response is guaranteed parseable.
 *
 * Requires ANTHROPIC_API_KEY; the runner skips judged cases when it is unset.
 */
import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const JUDGE_MODEL = "claude-opus-4-8";

export interface JudgeVerdict {
  score: number; // 1–5 overall
  dimensions: {
    issue_spotting_completeness: number;
    correct_law: number;
    uk_terminology: number;
    no_invented_facts: number;
  };
  failures: string[];
  reasoning: string;
}

const SCORE = { type: "integer", enum: [1, 2, 3, 4, 5] };

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    score: SCORE,
    dimensions: {
      type: "object",
      properties: {
        issue_spotting_completeness: SCORE,
        correct_law: SCORE,
        uk_terminology: SCORE,
        no_invented_facts: SCORE,
      },
      required: [
        "issue_spotting_completeness",
        "correct_law",
        "uk_terminology",
        "no_invented_facts",
      ],
      additionalProperties: false,
    },
    failures: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: ["score", "dimensions", "failures", "reasoning"],
  additionalProperties: false,
} as const;

const SYSTEM = `You are an exacting evaluator of AI-generated legal work product for an English-law
legal platform. Score strictly against the rubric provided. You are not being asked for legal
advice; you are grading output quality.

Scoring anchors: 5 = a supervising solicitor would sign this off with trivial edits;
3 = usable draft with material gaps; 1 = misleading, wrong law, or invented facts.
The overall score may not exceed no_invented_facts (fabrication caps the grade).
Apply UK English and the UK legal terminology conventions (solicitor/claimant/disclosure/
judgment; citations like "s.994 Companies Act 2006" or "[2024] UKSC 12"; DD/MM/YYYY dates).`;

export async function judge(params: {
  output: string;
  rubricPath: string; // relative to evals/
  evalsDir: string;
}): Promise<JudgeVerdict> {
  const rubric = readFileSync(join(params.evalsDir, params.rubricPath), "utf8");
  const client = new Anthropic();

  const response = await client.messages.create({
    model: JUDGE_MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: JUDGE_SCHEMA } },
    messages: [
      {
        role: "user",
        content: `<rubric>\n${rubric}\n</rubric>\n\n<output_under_evaluation>\n${params.output}\n</output_under_evaluation>\n\nScore the output against the rubric.`,
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("judge request refused by safety classifiers");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("judge returned no text block");
  return JSON.parse(text.text) as JudgeVerdict;
}
