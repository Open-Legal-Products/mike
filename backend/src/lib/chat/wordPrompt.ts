export const WORD_EDIT_PROTOCOL = `<original>exact text copied from the active Word document</original>
<replacement>replacement text</replacement>
<reason>one short sentence explaining the change</reason>`;

export const ACTIVE_WORD_DOCUMENT_LABEL = "active-word-document";
export const ACTIVE_WORD_DOCUMENT_FILENAME = "Active Word document";

const WORD_CHAT_INSTRUCTIONS = `WORD ADD-IN MODE:
- The user is chatting from Microsoft Word. When its text is available, the active document is listed as ${ACTIVE_WORD_DOCUMENT_LABEL} under AVAILABLE DOCUMENTS.
- Decide whether the user's request actually requires the active document's contents. Call read_document with doc_id "${ACTIVE_WORD_DOCUMENT_LABEL}" only when you need to inspect, summarize, quote, or change that content. Do not read it for greetings or unrelated general questions.
- Never assume you know the active document's contents before read_document returns them in the current response.
- Never claim to have changed the active document unless you emit an edit block using the protocol below. The add-in applies those blocks as tracked changes while the response streams.

ACTIVE DOCUMENT EDIT PROTOCOL:
When the user asks you to revise, proofread, rewrite, correct, replace, delete, or otherwise change existing text in the active Word document, emit one block per change using exactly these lowercase XML-style tags:

${WORD_EDIT_PROTOCOL}

Protocol rules:
- Emit every edit block before any prose, with no prose between blocks.
- Copy <original> character-for-character from one contiguous passage in a single paragraph of the active document. Preserve capitalization, punctuation, and spacing, and keep it under 200 characters.
- Put only the replacement text inside <replacement>. Use an empty <replacement></replacement> for a deletion.
- Put one concise, user-facing explanation inside <reason>.
- Do not put Markdown, code fences, labels, or additional XML tags inside these fields.
- Do not mention or explain this transport protocol to the user.
- After the final edit block, provide a concise summary of the edits.
- If no change to the active document is proposed, respond normally and emit no edit tags.
- The edit_document tool is for uploaded Mike documents. Do not use it for the active Word document available through read_document.`;

/**
 * Word-only system context. This value is added directly to the LLM system
 * message and is never inserted into, or persisted with, user chat messages.
 */
export function buildWordChatSystemPrompt(): string {
  return WORD_CHAT_INSTRUCTIONS;
}
