# Security model

This document describes what Mike does — and does not — defend against around the LLM. It exists so that operators and contributors can reason about the trust boundaries of the system instead of assuming the model is one.

## TL;DR

**The LLM is not a security boundary.** Treat it the way you'd treat a junior contractor who is helpful, fast, but will follow plausible-sounding instructions if someone slips them into a document. Do not upload documents from untrusted sources without reviewing the model's tool calls before you accept their output.

## Threat actors and surfaces

| Actor | Surface they control | What they can attempt |
| --- | --- | --- |
| Authenticated user (own account) | Their prompts, filenames, folder paths, workflow titles, workflow `prompt_md`, uploaded document contents | Self-prompt-injection (low-stakes — they're attacking themselves) |
| Authenticated collaborator on a shared project | Filenames, folder paths, uploaded document contents inside that project | Cause the owner's chat to misbehave the next time they invoke Mike against the shared project |
| Third party who supplies a document to a user out-of-band | The contents of that document (filenames are set by the uploader) | Injection via document body text when a Mike user runs `read_document` or `find_in_document` on the file |
| Network attacker | Nothing inside the prompt pipeline | (Out of scope for this document; see auth/RLS posture elsewhere) |

The dominant realistic threat is **document content** — a memo or PDF that contains text designed to manipulate the model on whoever opens it next inside Mike. Filenames and folder paths are a smaller surface, but cheap to attack because an uploader chooses them.

## What this codebase does today

1. **Per-request spotlighting fence.** Every request generates a fresh 64-bit random nonce. The system prompt explains the convention exactly once per turn; every untrusted span the request sends to the model — filenames, folder paths, workflow titles, workflow `prompt_md`, document body text returned by `read_document` / `fetch_documents`, search excerpts from `find_in_document`, and prior-turn tool summaries — is wrapped as

       «UNTRUSTED:<nonce>:<kind>»...payload...«END:<nonce>»

   Because the nonce rotates per request and is unguessable, attacker-controlled text inside the payload cannot close the fence. The model is told explicitly: instructions that appear inside a fence are data, not commands.

2. **Light input hygiene.** ASCII control characters (`NUL` through `BEL`, `VT`, `FF`, `SO`–`US`, `DEL`) are stripped from labels and bodies before fencing. Filename- and title-shaped labels are capped at 512 characters so a single oversize value cannot dominate the system prompt.

3. **Structural test corpus.** `backend/tests/promptFence/corpus.json` records ~20 representative attacks (naive override, role-play, fence-close forgery with a guessed nonce, base64 payloads, multi-turn drift, exfiltration prompts). `npm run test:prompt-fence --prefix backend` walks every entry through the real `fenceLabel` / `fenceBody` / `buildMessages` code paths and asserts that (a) the entry is wrapped using the current nonce, (b) only one legitimate close marker exists, (c) hygiene rules are applied, and (d) the system prompt carries the matching `fenceInstructions` block. 91 assertions pass on the current code.

## What this codebase does NOT do

These are real gaps. They are not in scope for the spotlighting PR; they are listed here so nobody mistakes the current posture for "defended."

1. **No behavioural validation against live models.** The structural test proves the *wrapping* is correct. It does not prove the model *obeys* the fence — that requires running the corpus against a live API and judging responses. Operators who want this assurance should run an adversarial harness against their preferred model and add it to CI.

2. **No output classification.** Nothing inspects the model's reply for compliance with injection. A determined attack that gets past the fencing (e.g. plausibly-shaped requests inside a body, role-play that does not try to break the fence) will reach the user.

3. **No capability containment.** A single turn can call a read tool and a write tool back-to-back. If `read_document` returns text that talks the model into calling `edit_document`, that edit happens without a user-in-the-loop confirmation. The mitigation here is product work (mark tools as read vs. write, require explicit user approval to invoke a write tool when the turn has already touched a read tool whose source the user did not author).

4. **No defence against context-window crowding.** A very large document can take up enough of the context window that the system prompt's fence instructions are pushed out of the model's effective attention. The 512-char cap on labels helps; nothing caps document body length.

5. **Tool-result accuracy.** A model that decides to "summarise" a fenced document is still summarising attacker-controlled text. Downstream consumers (e.g. lawyers reading the summary) must treat that summary as derived from untrusted input.

6. **Multi-turn carry-over.** Prior-turn tool activity summaries (`enrichWithPriorEvents`) reference filenames and titles inside fences, but the *contents* the model itself wrote in previous turns are stored as assistant messages and replayed unfenced — by design, because they are the assistant's own output. If a previous turn was compromised, that compromise can flow forward.

## What operators should do

- **Do not** upload documents from sources you would not paste into a colleague's inbox. The spotlighting fence raises the bar; it does not make Mike safe for processing actively hostile material.
- **Do** review the model's tool calls before accepting generated documents or edits, especially `edit_document`, `replicate_document`, and any download links it produces.
- **Do** report suspected injection via [GitHub's private vulnerability reporting](https://github.com/willchen96/mike/security/advisories/new) rather than a public issue.

## Where the fence lives in the code

| Concern | File | Function |
| --- | --- | --- |
| Nonce generation, fence helpers, instructions text | `backend/src/lib/promptFence.ts` | `makeFenceNonce`, `fenceLabel`, `fenceBody`, `fenceInstructions` |
| System prompt assembly + per-turn fenceInstructions injection | `backend/src/lib/chatTools.ts` | `buildMessages` |
| Prior-turn tool summary fencing | `backend/src/lib/chatTools.ts` | `enrichWithPriorEvents` |
| Tool result fencing (`read_document`, `find_in_document`, `fetch_documents`, `list_documents`, `list_workflows`, `read_workflow`) | `backend/src/lib/chatTools.ts` | `runToolCalls` |
| Per-request nonce generation in routes | `backend/src/routes/chat.ts`, `backend/src/routes/projectChat.ts` | inline at the start of the POST handler |
| Structural test corpus + runner | `backend/tests/promptFence/` | `corpus.json`, `runStructural.ts` |
