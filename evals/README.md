# JessicaOS eval harness

Golden-set runner per `docs/BUILD_PLAN.md` §4. Run from the repo root:

```bash
npm run evals          # full suite — CI merge gate (citation hard gate included)
npm run evals:smoke    # ≤5 cases tagged `smoke: true` — used by the Stop hook
```

First-time setup: `cd evals && npm install`.

## Case types (`cases/*.yaml`, one case per file)

| type | What it does | Fails when |
|---|---|---|
| `deterministic` | HTTP request with `status`/`contains` assertions (legislation.gov.uk needs no key; `auth: companies_house` uses `COMPANIES_HOUSE_API_KEY`) | any assertion fails |
| `citation` | **HARD GATE.** Extracts every statutory reference / SI / neutral citation from `input.text` and resolves each against the live legislation.gov.uk API | any citation fails to resolve. Neutral case citations always fail until Find Case Law is licensed (unverifiable citation = bug, CLAUDE.md rule 5) |
| `judged` | Scores `input.text` against `rubric` with an Opus judge (`claude-opus-4-8`, structured JSON output). Needs `ANTHROPIC_API_KEY` | `score < min_score` (default 3), or judged mean drops below `baseline.json` |

Extra flags: `smoke: true` (fast subset), `pending: "<reason>"` (reported, not run),
`expect_failure: true` (harness self-test — result inverted).

## Gates and CI expectations

- Exit code is non-zero on any failure — wire `npm run evals` as a required PR check.
- CI **must** set `ANTHROPIC_API_KEY` (judged cases are skipped without it, loudly) and
  `COMPANIES_HOUSE_API_KEY` once CH golden cases land.
- Regression gate: commit `evals/baseline.json` (`{"meanJudgedScore": <mean on main>}`)
  once the golden set is populated; the mean judged score may not drop below it.
- Model comparison (day 3): `npx tsx src/runner.ts --model <id>` is reserved for the
  provider-comparison run once workflows produce eval inputs.

## Populating the golden set

Target 25–30 cases. `input.text` for citation/judged cases will be produced by running
workflows on fixture documents (public/dummy docs only — see `docs/safe-local-testing.md`);
until that path exists, fixed-text cases exercise the gate itself. Deterministic Companies
House cases need human-confirmed company numbers and expected values.
