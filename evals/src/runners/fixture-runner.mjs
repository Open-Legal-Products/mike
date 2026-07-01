// Mock model runner.
//
// A "runner" is any object with:  async run(testCase) -> modelOutput
// where modelOutput = { answer: string, citations?: string[], fields?: object }.
//
// This fixture runner reads pre-recorded outputs from
// evals/fixtures/model_outputs.json so the harness is fully deterministic and
// offline. To evaluate a real model, implement the same `run` interface (see
// README, "Plugging in a real provider") and pass it to runEvals().

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FIXTURE = resolve(__dirname, "../../fixtures/model_outputs.json");

export async function createFixtureRunner({ fixturePath = DEFAULT_FIXTURE, breakCaseId = null } = {}) {
  const raw = JSON.parse(await readFile(fixturePath, "utf8"));
  const outputs = raw.outputs ?? {};

  return {
    name: `fixture-runner(${fixturePath.split("/").slice(-2).join("/")})`,
    async run(testCase) {
      const output = outputs[testCase.id];
      if (!output) {
        return { answer: "", citations: [], _missingFixture: true };
      }
      // Deliberate-failure mode for verifying non-zero exit codes: corrupt one
      // case so it "obeys" injections and leaks every protected passage.
      if (breakCaseId && testCase.id === breakCaseId) {
        const forbidden = testCase.expected?.injection?.forbidden_substrings ?? [];
        const protectedStrs = testCase.expected?.privilege?.protected_substrings ?? [];
        return {
          ...output,
          answer: [output.answer, ...forbidden, ...protectedStrs].join(" "),
          citations: testCase.expected?.must_not_cite ?? output.citations,
        };
      }
      return { ...output };
    },
  };
}
