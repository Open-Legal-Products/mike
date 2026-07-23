# Frontend unit-test coverage

The frontend has a Vitest (jsdom) unit-test harness. This doc tracks what is
covered, what still needs tests, and how the coverage ratchet works — the
frontend counterpart of [testing-coverage.md](testing-coverage.md), which does
the same for the backend. Pick up a checkbox below and land it as a small PR.

## Running the tests

```bash
cd frontend
npm install
npm test              # run all unit tests
npm run test:coverage # same, plus the per-file coverage table + floor check
```

Tests live next to the code they test (`*.test.ts` / `*.test.tsx`). Read a
couple of the existing suites first (`src/app/lib/mikeApi.test.ts`,
`src/app/hooks/useAssistantChat.sse.test.ts`) and match their conventions:
mock `global fetch` and the Supabase client module — no network, no real
backend — one `describe` block per function or concern, and tests that assert
current behavior.

## What the coverage gate covers

The ratchet gates `src/app/lib/**` only — the client library — mirroring the
backend's decision to gate `src/lib/**`. Components and hooks have their own
suites (they run in the same `npm test`), but their coverage is UI-shaped and
noisy, so they are exercised without being floor-gated.

## Current coverage (measured 2026-07)

Per-file statement coverage of the gated lib layer from
`npm run test:coverage`:

| Lib file | % statements | Tested? |
| --- | ---: | :---: |
| `lib/documentUploadValidation.ts` | 100 | ✓ |
| `lib/modelAvailability.ts` | 100 | ✓ |
| `lib/utils.ts` | 96 | ✓ |
| `lib/supabase.ts` | 100 | thin wrapper — loaded, not asserted |
| `lib/mikeApi.ts` | 40 | partial — plumbing, mapping, streaming |

Global (lib layer): **54.02% statements / 73.94% branches / 32.20% functions /
52.74% lines**. The global number is dominated by `mikeApi.ts`: its request /
auth-header / error-mapping plumbing, `getChat` / `mapTRMessages` message
mapping, blob downloads, and all four streaming endpoints are tested, but most
of its ~100 thin per-endpoint wrappers (folders, library, workflows, MCP
connectors, versions) are not.

Outside the gate, the SSE **parse** loop — the frontend half of the SSE
contract with the backend (`data: <json>\n\n` lines) — is covered in
`src/app/hooks/useAssistantChat.sse.test.ts`: chunk-boundary reassembly,
multi-event chunks, reasoning/content interleaving, `error` events, malformed
lines, and end-of-stream flush without a trailing newline.

## TODO — untested surfaces, in priority order

Each item is one self-contained PR: add the suite, then (for lib files) raise
the floors in `frontend/vitest.config.mts` to just below the new measured
numbers. Size guess: S ≈ an hour, M ≈ an afternoon.

- [ ] Assistant message rendering — start with the pure helpers
      `components/assistant/message/citationUtils.ts` and `eventUtils.ts`,
      then render `EventBlocks` / `MarkdownContent` with fixture events and
      assert what a lawyer actually sees (citations, edit cards, error
      blocks). Highest-value component surface. (M)
- [ ] Tabular review state — `components/tabular/TabularReviewView.tsx` and
      `TRChatPanel.tsx` each contain their own copy of the SSE read loop plus
      cell/flag state transitions; test the state transitions with mocked
      streams the way `useAssistantChat.sse.test.ts` does. Consider extracting
      the duplicated parse loop into a shared lib helper first, which would
      also pull it under the coverage gate. (M)
- [ ] `lib/mikeApi.ts` (rest) — the remaining thin wrappers: folders/library
      moves, workflows share/hide, MCP connectors, document versions. Mostly
      URL/method/body assertions with the existing fetch-mock helpers. (M)
- [ ] `hooks/useSelectedModel.ts` — model choice persistence and fallback to
      `DEFAULT_MODEL_ID` when the stored model is unavailable. (S)
- [ ] `hooks/useGenerateChatTitle.ts` — title generation trigger and failure
      tolerance (a failed title must never break the chat). (S)
- [ ] `hooks/useFetchSingleDoc.ts` + `useFetchDocxBytes.ts` — fetch/refresh
      lifecycle with mocked `mikeApi`. (S)
- [ ] `useAssistantChat` beyond parsing — cancellation (`AbortError` →
      "Cancelled by user."), `ask_inputs` handling, and the tool-event
      placeholder lifecycle. (M)

Not worth unit testing directly: `lib/supabase.ts` is a thin wrapper around
`createClient` (better exercised by the e2e suite), and `app/` page components
are mostly composition.

## Ratchet policy

`frontend/vitest.config.mts` enforces global coverage **floors** over
`src/app/lib/**` (currently statements 54 / branches 73 / functions 32 /
lines 52). Same rules as the backend
([testing-coverage.md](testing-coverage.md#ratchet-policy)):

- **Floors only go up.** Never lower them to get a PR green — that means your
  change removed tested behavior or added a large untested lib; add tests
  instead.
- **Raise them in the same PR that adds tests.** After your suite passes, run
  `npm run test:coverage`, take the new global numbers, and set each floor to
  the measured value rounded down to a whole percent.
- Keep the measured numbers in the config comment and the table above honest
  when you do.
