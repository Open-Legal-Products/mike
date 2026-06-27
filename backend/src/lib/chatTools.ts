import path from "path";
import {
  downloadFile,
  generatedDocKey,
  storageKey,
  uploadFile,
} from "./storage";
import { convertedPdfKey } from "./convert";
import { createServerSupabase } from "./supabase";
import {
  applyTrackedEdits,
  extractDocxBodyText,
  type EditInput,
} from "./docxTrackedChanges";
import { buildDownloadUrl } from "./downloadTokens";
import {
  attachActiveVersionPaths,
  contentSha256,
  loadActiveVersion,
} from "./documentVersions";
import {
  getCourtlistenerCaseOpinions,
  getCourtlistenerCases,
  searchCourtlistenerCaseLaw,
  verifyCourtlistenerCitations,
} from "./courtlistener";
import {
  COURTLISTENER_SYSTEM_PROMPT,
  COURTLISTENER_TOOL_NAMES,
  COURTLISTENER_TOOLS,
  type CaseCitationEvent,
  type CourtlistenerToolEvent,
} from "./legalSourcesTools/courtlistenerTools";
import {
  buildUserMcpTools,
  executeMcpToolCall,
  type McpToolEvent,
} from "./mcpConnectors";
import {
  streamChatWithTools,
  resolveModel,
  DEFAULT_MAIN_MODEL,
  type LlmMessage,
  type OpenAIToolSchema,
} from "./llm";
import { safeErrorMessage } from "./safeError";

const STANDARD_FONT_DATA_URL = (() => {
  try {
    const pkgPath = require.resolve("pdfjs-dist/package.json");
    return path.join(path.dirname(pkgPath), "standard_fonts") + path.sep;
  } catch {
    return undefined;
  }
})();
const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
  if (isDev) console.log(...args);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DocStore = Map<
  string,
  { storage_path: string; file_type: string; filename: string }
>;

export type WorkflowStore = Map<string, { title: string; prompt_md: string }>;

export type DocIndex = Record<
  string,
  {
    document_id: string;
    filename: string;
    version_id?: string | null;
    version_number?: number | null;
  }
>;

export type TabularCellStore = {
  columns: { index: number; name: string }[];
  documents: { id: string; filename: string }[];
  /** key: `${colIndex}:${docId}` */
  cells: Map<
    string,
    { summary: string; flag?: string; reasoning?: string } | null
  >;
};

export type ToolCall = {
  id: string;
  function: { name: string; arguments: string };
};

export type ChatMessage = {
  role: string;
  content: string | null;
  files?: { filename: string; document_id?: string }[];
  workflow?: { id: string; title: string };
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT_BEFORE_RESEARCH = `You are Mike, an AI legal assistant for lawyers and legal professionals. Help analyze documents, answer legal questions, and draft legal documents.

CORE RULES:
- Be precise, professional, and evidence-aware.
- Do not fabricate document content.
- Use at most 10 tool-use rounds per response. Batch independent tool calls and leave room for the final answer.
- If the user selects a workflow with [Workflow: <title> (id: <id>)], immediately call read_workflow with that id and follow the workflow before doing anything else.

DOCUMENT CITATIONS:
Use document citations only for verbatim evidence from uploaded or generated documents.

In prose, put sequential markers [1], [2], etc. exactly where the cited claim appears. The marker number is the citation "ref" value, not a page, footnote, section, or document number.

At the very end of the response, append:
<CITATIONS>
[
  {"ref": 1, "doc_id": "doc-0", "quotes": [{"page": 3, "quote": "exact verbatim text"}]},
  {"ref": 2, "doc_id": "doc-1", "quotes": [{"page": "41-42", "quote": "text before page break [[PAGE_BREAK]] text after page break"}]}
]
</CITATIONS>

Citation rules:
- Every [N] marker must have exactly one matching entry with "ref": N.
- "doc_id" must be the exact chat-local label you were given, such as "doc-0". Never use a filename or document UUID in "doc_id".
- Use one citation entry per marker. If one marker needs several passages, use "quotes" with 1 quote by default and at most 3.
- Keep quotes short, ideally 25 words or fewer, and tightly matched to the claim.
- "page" means the sequential [Page N] marker in the provided text, not printed page numbers inside the document.
- For a continuous quote crossing two pages, set "page" to "N-M" and include [[PAGE_BREAK]] at the page break. Otherwise, use separate quote objects.
- For legacy compatibility, you may also include top-level "page" and "quote" matching the first quote.
- Omit the <CITATIONS> block when there are no citations.

DOCX GENERATION:
- If the user asks you to create or draft a document, call generate_docx and provide the downloadable Word document rather than only displaying text inline.
- If the user asks to revise a document you just generated, call edit_document on that document unless they explicitly want a brand-new document or the change is too broad for coherent editing.
- Use heading levels in order; do not skip from Heading 1 to Heading 3.
- Numbering starts at 1, never 0. The generator applies legal numbering automatically. Do not type numbering prefixes into headings.
- Do not repeat the document title as the first section heading.
- Contract preambles, party blocks, recitals, and WHEREAS clauses are unnumbered. Begin numbering at the first operative clause or section.
- Contracts and agreements must end with an unnumbered signature block on a fresh page. Set pageBreak: true on the final section and include signature lines such as By, Name, Title, and Date for each party.

DOCUMENT EDITING:
When edit_document adds, deletes, moves, or reorders any numbered clause, section, schedule, exhibit, or list item:
- Renumber all affected downstream items in the same edit.
- Update all affected cross-references, including references in recitals, definitions, schedules, and exhibits.
- Before editing, scan the full document with read_document or find_in_document for affected references.
- If a reference might point to a shifted number, include the update and explain the reason.
- When deleting square brackets, delete both "[" and "]".`;

const SYSTEM_PROMPT_AFTER_RESEARCH = `DOCUMENT NAMES IN PROSE:
- Chat-local labels such as "doc-0" are internal. Use them only in tool arguments and citation JSON.
- Never show "doc-N" labels to the user in prose, headings, lists, or tool activity text.
- Refer to documents by filename or a natural description, such as "the NDA draft".

GENERAL GUIDANCE:
- Cite the exact document or fetched opinion passage for evidence-backed claims.
- If no documents are provided, answer from legal knowledge.
- Do not use emojis.
`;

/**
 * Assemble the chat system prompt. When `includeResearchTools` is true the
 * CourtListener (US case-law) research instructions are spliced in; when
 * false they are omitted entirely so the model is not told about tools it
 * does not have. Gated per-user by the Legal Research > US feature toggle.
 */
export function buildSystemPrompt(includeResearchTools = true): string {
  return includeResearchTools
    ? `${SYSTEM_PROMPT_BEFORE_RESEARCH}\n\n${COURTLISTENER_SYSTEM_PROMPT}\n${SYSTEM_PROMPT_AFTER_RESEARCH}`
    : `${SYSTEM_PROMPT_BEFORE_RESEARCH}\n\n${SYSTEM_PROMPT_AFTER_RESEARCH}`;
}

export const SYSTEM_PROMPT = buildSystemPrompt(true);

export const PROJECT_EXTRA_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_documents",
      description:
        "List all documents available in the project. Returns each document's ID, filename, and file type. Call this to discover what documents are available before deciding which ones to read.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "fetch_documents",
      description:
        "Read the full text content of multiple documents in a single call. Use this instead of calling read_document repeatedly when you need to read several documents at once.",
      parameters: {
        type: "object",
        properties: {
          doc_ids: {
            type: "array",
            items: { type: "string" },
            description:
              "Array of document IDs to read (e.g. ['doc-0', 'doc-2'])",
          },
        },
        required: ["doc_ids"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replicate_document",
      description:
        "Make byte-for-byte copies of an existing project document as new project documents. Use when the user wants standalone copies to edit (e.g. 'use this NDA as a template', 'give me three drafts I can adapt') without modifying the original. Pass `count` to create multiple copies in a single call rather than calling the tool repeatedly. Returns the new doc_id slugs so you can immediately call edit_document / read_document on them.",
      parameters: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "ID of the source document to copy (e.g. 'doc-0').",
          },
          count: {
            type: "integer",
            description:
              "How many copies to create. Defaults to 1. Maximum 20.",
            minimum: 1,
            maximum: 20,
          },
          new_filename: {
            type: "string",
            description:
              "Optional base filename. With count > 1, copies are suffixed (e.g. 'Foo (1).docx', 'Foo (2).docx'). Extension is forced to match the source.",
          },
        },
        required: ["doc_id"],
      },
    },
  },
];

export const TABULAR_TOOLS = [
  {
    type: "function",
    function: {
      name: "read_table_cells",
      description:
        "Read the extracted cell content from the tabular review. Each cell contains the value extracted for a specific column from a specific document. Pass col_indices and/or row_indices (0-based) to read a subset; omit either to read all columns or all rows.",
      parameters: {
        type: "object",
        properties: {
          col_indices: {
            type: "array",
            items: { type: "integer" },
            description:
              "0-based column indices to read (e.g. [0, 2]). Omit to read all columns.",
          },
          row_indices: {
            type: "array",
            items: { type: "integer" },
            description:
              "0-based document (row) indices to read (e.g. [0, 1]). Omit to read all rows.",
          },
        },
      },
    },
  },
];

export const WORKFLOW_TOOLS = [
  {
    type: "function",
    function: {
      name: "list_workflows",
      description:
        "List all workflows available to the user. Returns each workflow's ID and title. Call this when the user asks to run a workflow, apply a template, or you need to discover what workflows exist.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_workflow",
      description:
        "Read the full instructions (prompt) of a workflow by its ID. Call this after list_workflows to load a specific workflow's prompt, then follow those instructions.",
      parameters: {
        type: "object",
        properties: {
          workflow_id: {
            type: "string",
            description: "The workflow ID to read",
          },
        },
        required: ["workflow_id"],
      },
    },
  },
];

export const TOOLS = [
  {
    type: "function",
    function: {
      name: "read_document",
      description:
        "Read the full text content of a document attached by the user. Always call this before answering questions about, summarising, or citing from a document.",
      parameters: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "The document ID to read (e.g. 'doc-0', 'doc-1')",
          },
        },
        required: ["doc_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_in_document",
      description:
        "Search for specific strings inside a document — a Ctrl+F equivalent. Returns each match with surrounding context so you can locate and quote the exact text without reading the whole document. Matching is case-insensitive and whitespace-tolerant. Use this for targeted lookups (e.g. finding a clause title, party name, or a specific phrase) rather than reading the whole document.",
      parameters: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "The document ID to search (e.g. 'doc-0').",
          },
          query: {
            type: "string",
            description:
              "The string to search for. Matching is case-insensitive and collapses runs of whitespace, so 'Section 4.2' matches 'section   4.2'.",
          },
          max_results: {
            type: "integer",
            description:
              "Maximum number of matches to return (default 20). Use a smaller value for common terms.",
          },
          context_chars: {
            type: "integer",
            description:
              "Characters of surrounding context to include on each side of a match (default 80).",
          },
        },
        required: ["doc_id", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_docx",
      description:
        "Generate a Word (.docx) document from structured content. Use this when the user asks you to draft, create, or produce a legal document. Returns a download URL for the generated file.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Document title (used as filename and heading)",
          },
          landscape: {
            type: "boolean",
            description:
              "Set to true for landscape page orientation. Default is portrait.",
          },
          sections: {
            type: "array",
            description:
              "List of document sections. Each section may contain a heading, prose content, or a table.",
            items: {
              type: "object",
              properties: {
                heading: {
                  type: "string",
                  description: "Optional section heading",
                },
                level: {
                  type: "integer",
                  description: "Heading level: 1, 2, or 3",
                },
                content: {
                  type: "string",
                  description:
                    "Prose text content (paragraphs separated by double newlines)",
                },
                pageBreak: {
                  type: "boolean",
                  description:
                    "Set to true to start this section on a new page. Use for contract signature pages.",
                },
                table: {
                  type: "object",
                  description: "Optional table to render in this section",
                  properties: {
                    headers: {
                      type: "array",
                      items: { type: "string" },
                      description: "Column header labels",
                    },
                    rows: {
                      type: "array",
                      items: {
                        type: "array",
                        items: { type: "string" },
                      },
                      description:
                        "Array of rows, each row is an array of cell strings matching the headers order",
                    },
                  },
                  required: ["headers", "rows"],
                },
              },
            },
          },
        },
        required: ["title", "sections"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_document",
      description:
        "Propose edits to a user-attached .docx as tracked changes. Each edit is a precise, minimal substitution of specific words/characters, NOT a whole-line or paragraph replacement. Use read_document first. Anchor each edit with short before/after context so it can be located unambiguously. Returns per-edit annotations the UI will render as Accept/Reject cards and a download link to the edited document.",
      parameters: {
        type: "object",
        properties: {
          doc_id: {
            type: "string",
            description: "Document slug (e.g. 'doc-0').",
          },
          edits: {
            type: "array",
            description: "List of precise substitutions.",
            items: {
              type: "object",
              properties: {
                find: {
                  type: "string",
                  description:
                    "Exact substring to replace (keep it as short as possible — ideally just the words/chars being changed).",
                },
                replace: {
                  type: "string",
                  description:
                    "Replacement text. Empty string = pure deletion.",
                },
                context_before: {
                  type: "string",
                  description:
                    "~40 chars immediately preceding `find`, used to disambiguate.",
                },
                context_after: {
                  type: "string",
                  description: "~40 chars immediately following `find`.",
                },
                reason: {
                  type: "string",
                  description:
                    "Short explanation shown to the user on the card.",
                },
              },
              required: ["find", "replace", "context_before", "context_after"],
            },
          },
        },
        required: ["doc_id", "edits"],
      },
    },
  },
];

type ParsedDocumentCitation = {
  kind: "document";
  ref: number;
  doc_id: string;
  page: number | string;
  quote: string;
  quotes: {
    page: number | string;
    quote: string;
  }[];
};

type ParsedCaseCitation = {
  kind: "case";
  ref: number;
  cluster_id: number;
  quotes: {
    opinionId: number | null;
    type: string | null;
    author: string | null;
    quote: string;
  }[];
};

type ParsedCitation = ParsedDocumentCitation | ParsedCaseCitation;

function normalizeCitation(raw: unknown): ParsedCitation | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const markerRef =
    typeof c.marker === "string"
      ? Number(c.marker.match(/^\[(\d+)\]$/)?.[1])
      : NaN;
  const ref =
    typeof c.ref === "number"
      ? c.ref
      : Number.isFinite(markerRef)
        ? markerRef
        : null;
  if (typeof ref !== "number") return null;
  const quote = typeof c.quote === "string" ? c.quote : c.text;

  const rawClusterId =
    typeof c.cluster_id === "number"
      ? c.cluster_id
      : typeof c.clusterId === "number"
        ? c.clusterId
        : typeof c.cluster_id === "string"
          ? Number.parseInt(c.cluster_id, 10)
          : typeof c.clusterId === "string"
            ? Number.parseInt(c.clusterId, 10)
            : NaN;
  if (Number.isFinite(rawClusterId) && rawClusterId > 0) {
    const quotes = normalizeCaseCitationQuotes(c);
    if (!quotes.length) {
      if (typeof quote !== "string" || !quote) return null;
      quotes.push({
        opinionId: null,
        type: null,
        author: null,
        quote,
      });
    }
    return {
      kind: "case",
      ref,
      cluster_id: Math.floor(rawClusterId),
      quotes,
    };
  }

  if (typeof c.doc_id !== "string") return null;
  const quotes = normalizeDocumentCitationQuotes(c);
  if (!quotes.length) {
    if (typeof quote !== "string" || !quote) return null;
    quotes.push({ page: normalizeCitationPage(c.page), quote });
  }
  return {
    kind: "document",
    ref,
    doc_id: c.doc_id,
    page: quotes[0].page,
    quote: quotes[0].quote,
    quotes,
  };
}

function normalizeCitationPage(value: unknown): number | string {
  if (typeof value === "number") {
    return value;
  } else if (typeof value === "string" && /^\d+\s*-\s*\d+$/.test(value)) {
    return value;
  } else {
    const n = parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return 1;
    return n;
  }
}

function normalizeDocumentCitationQuotes(c: Record<string, unknown>) {
  if (!Array.isArray(c.quotes)) return [];
  return c.quotes
    .slice(0, 3)
    .map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
      }
      const row = raw as Record<string, unknown>;
      const text = typeof row.quote === "string" ? row.quote : row.text;
      if (typeof text !== "string" || !text.trim()) return null;
      return {
        page: normalizeCitationPage(row.page ?? c.page),
        quote: text,
      };
    })
    .filter(
      (quote): quote is { page: number | string; quote: string } => !!quote,
    );
}

function normalizeCaseCitationQuotes(c: Record<string, unknown>) {
  if (!Array.isArray(c.quotes)) return [];
  return c.quotes
    .slice(0, 3)
    .map((raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
      }
      const row = raw as Record<string, unknown>;
      const text = typeof row.quote === "string" ? row.quote : row.text;
      if (typeof text !== "string" || !text.trim()) return null;
      const opinionId =
        typeof row.opinion_id === "number" && Number.isFinite(row.opinion_id)
          ? Math.floor(row.opinion_id)
          : typeof row.opinionId === "number" && Number.isFinite(row.opinionId)
            ? Math.floor(row.opinionId)
            : null;
      return {
        opinionId,
        type: typeof row.type === "string" ? row.type : null,
        author: typeof row.author === "string" ? row.author : null,
        quote: text,
      };
    })
    .filter(
      (quote): quote is {
        opinionId: number | null;
        type: string | null;
        author: string | null;
        quote: string;
      } => !!quote,
    );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveDoc(rawId: string, docIndex: DocIndex) {
  return docIndex[rawId];
}

/**
 * Resolve whatever identifier the model passed (`doc-N` slug, filename, or
 * document UUID) back to a chat-local doc label. Generated docs surface in
 * tool results with both `doc_id` (slug) and `document_id` (UUID), so the
 * model often picks the wrong one — without this fallback `read_document`
 * silently returns "not found" and the model gives up and re-generates.
 */
export function resolveDocLabel(
  rawId: string,
  docStore: DocStore,
  docIndex?: DocIndex,
): string | null {
  if (docStore.has(rawId)) return rawId;
  for (const [label, info] of docStore.entries()) {
    if (info.filename === rawId) return label;
  }
  if (docIndex) {
    for (const [label, info] of Object.entries(docIndex)) {
      if (info.document_id === rawId) return label;
    }
  }
  return null;
}

function citationReminder(docLabel: string, filename: string): string {
  return [
    `[Citation requirement for ${docLabel} ("${filename}")]:`,
    `If your final answer makes any factual claim from this document, include inline [N] markers and append a final <CITATIONS> JSON block.`,
    `Every citation entry for this document MUST use "doc_id": "${docLabel}".`,
    `Use this citation object shape: {"ref": 1, "doc_id": "${docLabel}", "quotes": [{"page": 1, "quote": "exact verbatim text from the document"}]}. Include top-level "page" and "quote" too only if they match the first quote.`,
    `Do not use "marker" or "text" keys in the citation block; use "ref" and "quotes".`,
  ].join("\n");
}

/**
 * Append a tool-activity summary to the most recent assistant message so
 * the model can see what it just did (read / create / edit / workflow
 * applied) in the prior turn — otherwise it only sees its own prose and
 * forgets which docs it touched, which leads to e.g. re-generating a doc
 * that already exists.
 *
 * Doc references use the *current-turn* `doc_id` slug (looked up by
 * matching the event's stored `document_id` against this turn's freshly
 * built `docIndex`), since slugs are reassigned every turn and the old
 * slug from the prior turn would be meaningless. Falls back to filename
 * only if the doc is no longer in the index (deleted, scope changed).
 */
export async function enrichWithPriorEvents(
  messages: ChatMessage[],
  chatId: string | null | undefined,
  db: ReturnType<typeof createServerSupabase>,
  docIndex: DocIndex,
): Promise<ChatMessage[]> {
  if (!chatId) return messages;
  const { data: rows } = await db
    .from("chat_messages")
    .select("content, created_at")
    .eq("chat_id", chatId)
    .eq("role", "assistant")
    .order("created_at", { ascending: false })
    .limit(1);

  const lastRow = rows?.[0] as { content?: unknown } | undefined;
  const content = lastRow?.content;
  if (!Array.isArray(content)) return messages;

  const slugByDocumentId = new Map<string, string>();
  for (const [slug, info] of Object.entries(docIndex)) {
    if (info.document_id) slugByDocumentId.set(info.document_id, slug);
  }
  const refFor = (documentId: unknown, filename: unknown) => {
    const slug =
      typeof documentId === "string"
        ? slugByDocumentId.get(documentId)
        : undefined;
    return slug ? `${slug} ("${filename}")` : `"${filename}"`;
  };

  const lines: string[] = [];
  for (const ev of content as Record<string, unknown>[]) {
    if (ev?.type === "doc_created") {
      lines.push(`- generate_docx → ${refFor(ev.document_id, ev.filename)}`);
    } else if (ev?.type === "doc_edited") {
      lines.push(`- edit_document → ${refFor(ev.document_id, ev.filename)}`);
    } else if (ev?.type === "doc_read") {
      lines.push(`- read_document → ${refFor(ev.document_id, ev.filename)}`);
    } else if (ev?.type === "doc_replicated") {
      // The model needs to know what each copy resolved to so it
      // can call edit_document / read_document on them. Emit one
      // line per copy, all attributed back to the same source.
      const srcLabel =
        typeof ev.filename === "string" ? `"${ev.filename}"` : "";
      const copies = Array.isArray(ev.copies)
        ? (ev.copies as {
            new_filename?: unknown;
            document_id?: unknown;
          }[])
        : [];
      for (const c of copies) {
        const ref = refFor(c.document_id, c.new_filename);
        lines.push(
          srcLabel
            ? `- replicate_document → ${ref} (copy of ${srcLabel})`
            : `- replicate_document → ${ref}`,
        );
      }
    } else if (ev?.type === "workflow_applied") {
      lines.push(`- applied workflow: "${ev.title}"`);
    }
  }
  if (lines.length === 0) return messages;
  const summary = `\n\n[Tool activity in your previous turn]\n${lines.join("\n")}`;

  // Find the index of the last assistant message and attach the
  // summary there only.
  let lastAssistantIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) return messages;
  const enriched = messages.slice();
  const target = enriched[lastAssistantIdx];
  enriched[lastAssistantIdx] = {
    ...target,
    content: (target.content ?? "") + summary,
  };
  return enriched;
}

export function buildMessages(
  messages: ChatMessage[],
  docAvailability: {
    doc_id: string;
    filename: string;
    folder_path?: string;
  }[],
  systemPromptExtra?: string,
  docIndex?: DocIndex,
  includeResearchTools = true,
) {
  const formatted: unknown[] = [];
  let systemContent = buildSystemPrompt(includeResearchTools);

  if (systemPromptExtra) {
    systemContent += `\n\n${systemPromptExtra.trim()}`;
  }

  if (docAvailability.length) {
    systemContent += "\n\n---\nAVAILABLE DOCUMENTS:\n";
    for (const doc of docAvailability) {
      const label = doc.folder_path
        ? `${doc.folder_path} / ${doc.filename}`
        : doc.filename;
      systemContent += `- ${doc.doc_id}: ${label}\n`;
    }
    systemContent +=
      "\nYou do NOT retain document content between conversation turns. You MUST call read_document (or fetch_documents) at the start of every response that involves a document's content, even if you have read it in a previous turn. Failure to do so will result in hallucinated or stale content.\n---\n";
  }
  formatted.push({ role: "system", content: systemContent });

  // Map document_id (UUID) → current-turn doc_id slug, so when we
  // inline a user attachment we hand the model the same handle it
  // would use to call read_document / fetch_documents.
  const slugByDocumentId = new Map<string, string>();
  if (docIndex) {
    for (const [slug, info] of Object.entries(docIndex)) {
      if (info.document_id) slugByDocumentId.set(info.document_id, slug);
    }
  }

  for (const msg of messages) {
    let content = msg.content ?? "";
    if (msg.role === "user" && msg.workflow) {
      content = `[Workflow: ${msg.workflow.title} (id: ${msg.workflow.id})]\n\n${content}`;
    }
    if (msg.role === "user" && msg.files?.length) {
      const lines = msg.files.map((f) => {
        const slug = f.document_id
          ? slugByDocumentId.get(f.document_id)
          : undefined;
        return slug ? `- ${slug}: ${f.filename}` : `- ${f.filename}`;
      });
      content = `[The user attached the following document(s) to this message:\n${lines.join("\n")}]\n\n${content}`;
    }
    formatted.push({ role: msg.role, content });
  }
  return formatted;
}

export async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  try {
    const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
    const pdf = await (
      pdfjsLib as unknown as {
        getDocument: (opts: unknown) => {
          promise: Promise<{
            numPages: number;
            getPage: (n: number) => Promise<{
              getTextContent: () => Promise<{
                items: { str?: string }[];
              }>;
            }>;
          }>;
        };
      }
    ).getDocument({
      data: new Uint8Array(buf),
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
    }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      parts.push(
        `[Page ${i}]\n${textContent.items.map((it) => it.str ?? "").join(" ")}`,
      );
    }
    return parts.join("\n\n");
  } catch {
    return "";
  }
}

export async function generateDocx(
  title: string,
  sections: unknown[],
  userId: string,
  db: ReturnType<typeof createServerSupabase>,
  options?: { landscape?: boolean; projectId?: string | null },
) {
  try {
    const {
      Document,
      Paragraph,
      HeadingLevel,
      Packer,
      Table,
      TableRow,
      TableCell,
      WidthType,
      BorderStyle,
      TextRun,
      AlignmentType,
      LevelFormat,
      LevelSuffix,
      PageOrientation,
      PageBreak,
    } = await import("docx");

    const FONT = "Times New Roman";
    const SIZE = 22; // 11pt in half-points

    type DocChild = InstanceType<typeof Paragraph> | InstanceType<typeof Table>;
    const children: DocChild[] = [];
    children.push(
      new Paragraph({
        heading: HeadingLevel.TITLE,
        spacing: { after: 200 },
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({
            text: title.toUpperCase(),
            color: "000000",
            font: FONT,
            size: SIZE,
            bold: true,
          }),
        ],
      }),
    );

    const cellBorder = {
      top: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      left: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
      right: { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" },
    };

    const headingLevels = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
    ];
    const LEGAL_NUMBERING_REF = "legal-clause-numbering";
    const legalNumbering = (level: number) => ({
      reference: LEGAL_NUMBERING_REF,
      level: Math.max(0, Math.min(level, 4)),
    });
    const legalNumberingLevels = [
      {
        level: 0,
        format: LevelFormat.DECIMAL,
        text: "%1.",
        alignment: AlignmentType.START,
        suffix: LevelSuffix.TAB,
        isLegalNumberingStyle: true,
        style: {
          paragraph: { indent: { left: 720, hanging: 720 } },
          run: {
            bold: true,
            color: "000000",
            font: FONT,
            size: SIZE,
          },
        },
      },
      {
        level: 1,
        format: LevelFormat.DECIMAL,
        text: "%1.%2",
        alignment: AlignmentType.START,
        suffix: LevelSuffix.TAB,
        isLegalNumberingStyle: true,
        style: {
          paragraph: { indent: { left: 720, hanging: 720 } },
          run: { color: "000000", font: FONT, size: SIZE },
        },
      },
      {
        level: 2,
        format: LevelFormat.LOWER_LETTER,
        text: "(%3)",
        alignment: AlignmentType.START,
        suffix: LevelSuffix.TAB,
        style: {
          paragraph: { indent: { left: 1440, hanging: 720 } },
          run: { color: "000000", font: FONT, size: SIZE },
        },
      },
      {
        level: 3,
        format: LevelFormat.LOWER_ROMAN,
        text: "(%4)",
        alignment: AlignmentType.START,
        suffix: LevelSuffix.TAB,
        style: {
          paragraph: { indent: { left: 1440, hanging: 720 } },
          run: { color: "000000", font: FONT, size: SIZE },
        },
      },
      {
        level: 4,
        format: LevelFormat.UPPER_LETTER,
        text: "(%5)",
        alignment: AlignmentType.START,
        suffix: LevelSuffix.TAB,
        style: {
          paragraph: { indent: { left: 2520, hanging: 720 } },
          run: { color: "000000", font: FONT, size: SIZE },
        },
      },
    ];
    const normalizeTable = (
      table: unknown,
    ): { headers: string[]; rows: string[][] } | null => {
      if (!table || typeof table !== "object") return null;
      const raw = table as { headers?: unknown; rows?: unknown };
      const headers = Array.isArray(raw.headers)
        ? raw.headers
            .map((header) => (typeof header === "string" ? header.trim() : ""))
            .filter(Boolean)
        : [];
      if (headers.length === 0) return null;

      const rawRows = Array.isArray(raw.rows) ? raw.rows : [];
      const rows = rawRows
        .filter((row): row is unknown[] => Array.isArray(row))
        .map((row) =>
          headers.map((_, i) => (typeof row[i] === "string" ? row[i] : "")),
        );

      return { headers, rows };
    };
    const stripManualNumbering = (
      value: string,
    ): { text: string; levelFromPrefix: number | null } => {
      const match = value.trim().match(/^(\d+(?:\.\d+)*)(?:[.)])?\s+(.+)$/);
      if (!match) return { text: value.trim(), levelFromPrefix: null };
      return {
        text: match[2].trim(),
        levelFromPrefix: match[1].split(".").length - 1,
      };
    };
    const parseManualListMarker = (
      value: string,
    ): { text: string; levelOffset: number | null } => {
      const trimmed = value.trim();
      const match = trimmed.match(/^(\(([a-z]+)\)|([a-z]+)[.)])\s+(.+)$/i);
      if (!match) return { text: trimmed, levelOffset: null };
      const marker = (match[2] ?? match[3] ?? "").toLowerCase();
      const isRoman =
        marker === "i" ||
        (marker.length > 1 &&
          /^(?:m{0,4}(?:cm|cd|d?c{0,3})(?:xc|xl|l?x{0,3})(?:ix|iv|v?i{0,3}))$/i.test(
            marker,
          ));
      return { text: match[4].trim(), levelOffset: isRoman ? 3 : 2 };
    };
    const normalizeHeadingText = (value: string) =>
      value
        .trim()
        .replace(/[^a-zA-Z0-9]+/g, " ")
        .trim()
        .toLowerCase();

    const isTitleLikeFirstHeading = (heading: string, sectionIndex: number) => {
      if (sectionIndex !== 0) return false;
      const normalized = normalizeHeadingText(heading);
      const titleNormalized = normalizeHeadingText(title);
      if (!normalized || !titleNormalized) return false;
      if (normalized === titleNormalized) return true;
      return (
        titleNormalized.includes(normalized) &&
        /\b(agreement|contract|deed|terms|policy|notice|nda|disclosure)\b/.test(
          normalized,
        )
      );
    };

    const isUnnumberedHeading = (heading: string, sectionIndex: number) => {
      const normalized = normalizeHeadingText(heading);
      if (!normalized) return true;
      if (normalized === "signatures" || normalized === "signature") {
        return true;
      }
      if (isTitleLikeFirstHeading(heading, sectionIndex)) {
        return true;
      }
      if (
        sectionIndex === 0 &&
        /^(agreement|contract|mutual non disclosure agreement|non disclosure agreement|employment agreement|service level agreement)$/.test(
          normalized,
        )
      ) {
        return true;
      }
      return false;
    };
    const isSignatureLine = (value: string) =>
      /^(?:by|name|title|date):\s*/i.test(value.trim());
    const looksLikeSignatureBlock = (value: string) => {
      const lines = value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      if (lines.length === 0) return false;
      const signatureLineCount = lines.filter(isSignatureLine).length;
      return signatureLineCount >= 2;
    };
    let currentClauseLevel: number | null = null;

    for (const [sectionIndex, section] of (
      sections as {
        heading?: string;
        content?: string;
        level?: number;
        pageBreak?: boolean;
        table?: { headers: string[]; rows: string[][] };
      }[]
    ).entries()) {
      if (section.pageBreak) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
      if (section.heading) {
        const stripped = stripManualNumbering(section.heading);
        const isUnnumbered = isUnnumberedHeading(stripped.text, sectionIndex);
        const skipHeading = isTitleLikeFirstHeading(
          stripped.text,
          sectionIndex,
        );
        const idx = Math.min(
          stripped.levelFromPrefix ?? (section.level ?? 1) - 1,
          3,
        );
        currentClauseLevel = isUnnumbered || skipHeading ? null : idx;
        const headingText =
          idx === 0 && !isUnnumbered
            ? stripped.text.toUpperCase()
            : stripped.text;
        if (!skipHeading) {
          children.push(
            new Paragraph({
              heading: headingLevels[idx],
              numbering: isUnnumbered ? undefined : legalNumbering(idx),
              spacing: { after: 160 },
              children: [
                new TextRun({
                  text: headingText,
                  color: "000000",
                  font: FONT,
                  size: SIZE,
                  bold: true,
                }),
              ],
            }),
          );
        }
      }
      const normalizedTable = normalizeTable(section.table);
      if (normalizedTable) {
        const { headers, rows } = normalizedTable;
        const colCount = headers.length;
        const tableRows: InstanceType<typeof TableRow>[] = [];
        // Header row
        tableRows.push(
          new TableRow({
            tableHeader: true,
            children: headers.map(
              (h) =>
                new TableCell({
                  borders: cellBorder,
                  shading: { fill: "F2F2F2" },
                  children: [
                    new Paragraph({
                      children: [
                        new TextRun({
                          text: h,
                          bold: true,
                          font: FONT,
                          size: SIZE,
                        }),
                      ],
                      alignment: AlignmentType.LEFT,
                    }),
                  ],
                }),
            ),
          }),
        );
        // Data rows — normalize each row to exactly colCount cells.
        // LLMs occasionally emit malformed rows (extra fragments from
        // stray delimiters, or short rows); padding/truncating here
        // keeps the rendered table aligned to the headers.
        for (const normalized of rows) {
          tableRows.push(
            new TableRow({
              children: normalized.map(
                (cell) =>
                  new TableCell({
                    borders: cellBorder,
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text: cell,
                            font: FONT,
                            size: SIZE,
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            }),
          );
        }
        children.push(
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: tableRows,
          }),
        );
        children.push(new Paragraph({ text: "" }));
      }
      if (section.content) {
        let numberedBodyParagraphs = 0;
        const contentIsSignatureBlock =
          section.heading &&
          normalizeHeadingText(section.heading).includes("signature")
            ? true
            : looksLikeSignatureBlock(section.content);
        for (const line of section.content.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          const bulletMatch = trimmed.match(/^[-•*]\s+(.+)/);
          const rawText = bulletMatch ? bulletMatch[1].trim() : trimmed;
          const manualList = parseManualListMarker(rawText);
          const numeric = stripManualNumbering(rawText);
          const text = bulletMatch
            ? rawText
            : manualList.levelOffset !== null
              ? manualList.text
              : numeric.text;
          const inferredLevel =
            currentClauseLevel === null || contentIsSignatureBlock
              ? undefined
              : bulletMatch
                ? currentClauseLevel + 2
                : manualList.levelOffset !== null
                  ? currentClauseLevel + manualList.levelOffset
                  : numeric.levelFromPrefix !== null
                    ? numeric.levelFromPrefix
                    : numberedBodyParagraphs === 0
                      ? currentClauseLevel + 1
                      : currentClauseLevel + 2;
          if (currentClauseLevel !== null) numberedBodyParagraphs++;
          children.push(
            new Paragraph({
              numbering:
                inferredLevel === undefined
                  ? undefined
                  : legalNumbering(inferredLevel),
              spacing: { after: 120 },
              children: [
                new TextRun({
                  text,
                  font: FONT,
                  size: SIZE,
                }),
              ],
            }),
          );
        }
      }
    }

    const pageSetup = options?.landscape
      ? { page: { size: { orientation: PageOrientation.LANDSCAPE } } }
      : {};

    const doc = new Document({
      numbering: {
        config: [
          {
            reference: LEGAL_NUMBERING_REF,
            levels: legalNumberingLevels,
          },
        ],
      },
      sections: [{ properties: pageSetup, children }],
    });
    const buf = await Packer.toBuffer(doc);
    const zip = await import("jszip");
    const packageZip = await zip.default.loadAsync(buf);
    for (const requiredPath of [
      "[Content_Types].xml",
      "word/document.xml",
      "word/_rels/document.xml.rels",
    ]) {
      if (!packageZip.file(requiredPath)) {
        return {
          error: `Generated DOCX is missing required package part: ${requiredPath}`,
        };
      }
    }
    const docId = crypto.randomUUID().replace(/-/g, "");
    const safeTitle =
      title
        .replace(/[^a-zA-Z0-9 -]/g, "")
        .trim()
        .slice(0, 64) || "document";
    const filename = `${safeTitle}.docx`;
    const key = generatedDocKey(userId, docId, filename);

    await uploadFile(
      key,
      buf.buffer as ArrayBuffer,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    const downloadUrl = buildDownloadUrl(key, filename);

    // Persist to DB so generated docs are first-class documents:
    // openable in the DocPanel and editable via edit_document. In
    // project chats we attach to the project so it appears in the
    // sidebar; in the general chat we leave project_id null and it
    // stays a standalone document.
    const { data: docRow, error: docErr } = await db
      .from("documents")
      .insert({
        project_id: options?.projectId ?? null,
        user_id: userId,
        status: "ready",
      })
      .select("id")
      .single();
    if (docErr || !docRow) {
      return {
        error: `Failed to record generated document: ${docErr?.message ?? "unknown"}`,
      };
    }
    const documentId = docRow.id as string;

    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: documentId,
        storage_path: key,
        source: "generated",
        version_number: 1,
        filename: filename,
        file_type: "docx",
        size_bytes: buf.byteLength,
        page_count: null,
        content_sha256: contentSha256(buf),
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      return {
        error: `Failed to record generated document version: ${verErr?.message ?? "unknown"}`,
      };
    }
    const versionId = versionRow.id as string;

    await db
      .from("documents")
      .update({
        current_version_id: versionId,
      })
      .eq("id", documentId);

    return {
      filename,
      download_url: downloadUrl,
      document_id: documentId,
      version_id: versionId,
      version_number: 1,
      storage_path: key,
      message: `Document '${filename}' has been generated successfully.`,
    };
  } catch (e) {
    return { error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Document version helpers (DOCX tracked-change editing)
// ---------------------------------------------------------------------------

/**
 * Resolve the current .docx bytes for a document, preferring the active
 * tracked-changes version if one exists, else the original upload.
 */
export async function loadCurrentVersionBytes(
  documentId: string,
  db: ReturnType<typeof createServerSupabase>,
): Promise<{ bytes: Buffer; storage_path: string } | null> {
  const active = await loadActiveVersion(documentId, db);
  if (!active) return null;
  const raw = await downloadFile(active.storage_path);
  if (!raw) return null;
  return { bytes: Buffer.from(raw), storage_path: active.storage_path };
}

/**
 * Ensure the document has a document_versions row for the current upload.
 * Called before writing the first 'assistant_edit' row so the history is
 * complete. Idempotent.
 */
export async function runEditDocument(params: {
  documentId: string;
  userId: string;
  edits: EditInput[];
  db: ReturnType<typeof createServerSupabase>;
  /**
   * If provided, append these edits to the existing turn-scoped version
   * (overwrites the file at storagePath and reuses the document_versions
   * row) instead of creating a new version. Used to collapse multiple
   * edit_document tool calls within a single assistant turn into one
   * version.
   */
  reuseVersion?: {
    versionId: string;
    versionNumber: number;
    storagePath: string;
  };
}): Promise<
  | {
      ok: true;
      version_id: string;
      version_number: number;
      storage_path: string;
      download_url: string;
      annotations: EditAnnotation[];
      errors: { index: number; reason: string }[];
    }
  | { ok: false; error: string }
> {
  const { documentId, userId, edits, db, reuseVersion } = params;

  const { data: doc } = await db
    .from("documents")
    .select("id")
    .eq("id", documentId)
    .single();
  if (!doc) return { ok: false, error: "Document not found." };

  const activeVersion = await loadActiveVersion(documentId, db);
  let versionFilename =
    activeVersion?.filename?.trim() || "Untitled document";

  const current = await loadCurrentVersionBytes(documentId, db);
  if (!current) return { ok: false, error: "Could not load document bytes." };

  const {
    bytes: editedBytes,
    changes,
    errors,
  } = await applyTrackedEdits(current.bytes, edits, { author: "Mike" });

  if (changes.length === 0) {
    return {
      ok: false,
      error:
        errors[0]?.reason ??
        "No edits could be applied. Refine context_before/context_after and retry.",
    };
  }

  const ab = editedBytes.buffer.slice(
    editedBytes.byteOffset,
    editedBytes.byteOffset + editedBytes.byteLength,
  ) as ArrayBuffer;

  let versionRowId: string;
  let newPath: string;
  let nextVersionNumber: number;

  if (reuseVersion) {
    // Overwrite the existing turn version's file in place. The version
    // row, version_number, and current_version_id all already point here.
    newPath = reuseVersion.storagePath;
    versionRowId = reuseVersion.versionId;
    nextVersionNumber = reuseVersion.versionNumber;
    await uploadFile(
      newPath,
      ab,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    await db
      .from("document_versions")
      .update({
        file_type: "docx",
        size_bytes: editedBytes.byteLength,
        page_count: null,
        content_sha256: contentSha256(editedBytes),
      })
      .eq("id", versionRowId);
  } else {
    const versionId = crypto.randomUUID().replace(/-/g, "");
    newPath = `documents/${userId}/${documentId}/edits/${versionId}.docx`;
    await uploadFile(
      newPath,
      ab,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );

    // Per-document sequential number for the new assistant_edit
    // version. The counter spans upload + user_upload + assistant_edit
    // so the original upload is V1 and the first assistant edit is V2.
    const { data: maxRow } = await db
      .from("document_versions")
      .select("version_number")
      .eq("document_id", documentId)
      .in("source", ["upload", "user_upload", "assistant_edit"])
      .order("version_number", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    nextVersionNumber = ((maxRow?.version_number as number | null) ?? 1) + 1;

    // Inherit the filename from the most recent prior version so
    // user-applied renames carry forward through further edits. Malformed
    // legacy rows without a filename get a neutral placeholder, not the
    // parent document filename. We intentionally do NOT append "[Edited Vn]"
    // — the version number is surfaced separately as a tag in the UI.
    const { data: prevRow } = await db
      .from("document_versions")
      .select("filename, created_at")
      .eq("document_id", documentId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const inheritedFilename =
      (prevRow?.filename as string | null)?.trim() || "Untitled document";
    versionFilename = inheritedFilename;

    const { data: versionRow, error: verErr } = await db
      .from("document_versions")
      .insert({
        document_id: documentId,
        storage_path: newPath,
        source: "assistant_edit",
        version_number: nextVersionNumber,
        filename: inheritedFilename,
        file_type: "docx",
        size_bytes: editedBytes.byteLength,
        page_count: null,
        content_sha256: contentSha256(editedBytes),
      })
      .select("id")
      .single();
    if (verErr || !versionRow) {
      return { ok: false, error: "Failed to record document version." };
    }
    versionRowId = versionRow.id as string;
  }

  // Insert one row per change
  const editRows = changes.map((c) => ({
    document_id: documentId,
    version_id: versionRowId,
    change_id: c.id,
    del_w_id: c.delId ?? null,
    ins_w_id: c.insId ?? null,
    deleted_text: c.deletedText,
    inserted_text: c.insertedText,
    context_before: c.contextBefore ?? "",
    context_after: c.contextAfter ?? "",
    status: "pending" as const,
  }));
  const { data: insertedEdits, error: editsErr } = await db
    .from("document_edits")
    .insert(editRows)
    .select(
      "id, change_id, del_w_id, ins_w_id, deleted_text, inserted_text, context_before, context_after",
    );

  if (editsErr || !insertedEdits) {
    return { ok: false, error: "Failed to record edits." };
  }

  await db
    .from("documents")
    .update({
      current_version_id: versionRowId,
    })
    .eq("id", documentId);

  const annotations: EditAnnotation[] = insertedEdits.map(
    (r: {
      id: string;
      change_id: string;
      deleted_text: string;
      inserted_text: string;
      context_before: string | null;
      context_after: string | null;
    }) => {
      const src = changes.find((c) => c.id === r.change_id);
      return {
        kind: "edit",
        edit_id: r.id,
        document_id: documentId,
        version_id: versionRowId,
        version_number: nextVersionNumber,
        change_id: r.change_id,
        del_w_id: src?.delId,
        ins_w_id: src?.insId,
        deleted_text: r.deleted_text ?? "",
        inserted_text: r.inserted_text ?? "",
        context_before: r.context_before ?? "",
        context_after: r.context_after ?? "",
        reason: src?.reason,
        status: "pending",
      };
    },
  );

  // Persistent, non-expiring permalink. The backend streams fresh bytes
  // on each request, so this URL stays valid as long as the file exists.
  const resolvedFilename = versionFilename.trim() || "Untitled document.docx";
  const permalink = buildDownloadUrl(newPath, resolvedFilename);

  return {
    ok: true,
    version_id: versionRowId,
    version_number: nextVersionNumber,
    storage_path: newPath,
    download_url: permalink,
    annotations,
    errors,
  };
}

// ---------------------------------------------------------------------------
// Tool dispatch
// ---------------------------------------------------------------------------

async function readDocumentContent(
  docLabel: string,
  docStore: DocStore,
  write: (s: string) => void,
  docIndex?: DocIndex,
  db?: ReturnType<typeof createServerSupabase>,
  opts?: { emitEvents?: boolean },
): Promise<string> {
  const emitEvents = opts?.emitEvents ?? true;
  devLog(`[read_document] called with docLabel="${docLabel}"`);
  const docInfo = docStore.get(docLabel);
  if (!docInfo) {
    devLog(
      `[read_document] MISS — docLabel "${docLabel}" not in docStore. Known labels:`,
      Array.from(docStore.keys()),
    );
    return "Document not found.";
  }
  devLog(
    `[read_document] docInfo: filename="${docInfo.filename}", file_type="${docInfo.file_type}", storage_path="${docInfo.storage_path}"`,
  );

  const documentId = docIndex?.[docLabel]?.document_id;
  const emitDocRead = () => {
    if (!emitEvents) return;
    write(
      `data: ${JSON.stringify({
        type: "doc_read",
        filename: docInfo.filename,
        document_id: documentId,
      })}\n\n`,
    );
  };
  if (emitEvents)
    write(
      `data: ${JSON.stringify({
        type: "doc_read_start",
        filename: docInfo.filename,
        document_id: documentId,
      })}\n\n`,
    );
  try {
    // Prefer the current tracked-changes version (if any) so read_document
    // reflects accepted/pending edits rather than the original upload.
    let raw: ArrayBuffer | null = null;
    let sourcePath = docInfo.storage_path;
    if (documentId && db) {
      const current = await loadCurrentVersionBytes(documentId, db);
      if (current) {
        raw = current.bytes.buffer.slice(
          current.bytes.byteOffset,
          current.bytes.byteOffset + current.bytes.byteLength,
        ) as ArrayBuffer;
        sourcePath = current.storage_path;
        devLog(
          `[read_document] using current version path="${sourcePath}" (bytes=${raw.byteLength})`,
        );
      } else {
        devLog(
          `[read_document] loadCurrentVersionBytes returned null for documentId="${documentId}", falling back to original storage_path`,
        );
      }
    }
    if (!raw) {
      raw = await downloadFile(docInfo.storage_path);
      if (raw) {
        devLog(
          `[read_document] fallback download from storage_path="${docInfo.storage_path}" (bytes=${raw.byteLength})`,
        );
      }
    }
    if (!raw) {
      devLog(
        `[read_document] FAILED to download any bytes for docLabel="${docLabel}" (tried path="${sourcePath}")`,
      );
      emitDocRead();
      return "Document could not be read.";
    }
    // Log the first 8 bytes so we can identify real file format regardless
    // of the declared file_type. Valid .docx starts with "PK\x03\x04"
    // (zip). Legacy .doc starts with "\xD0\xCF\x11\xE0" (OLE/CFB).
    // %PDF-1 is a PDF even if mislabeled. Truncated uploads show as all-zero.
    {
      const head = Buffer.from(raw).subarray(0, 8);
      const hex = head.toString("hex");
      const ascii = head.toString("binary").replace(/[^\x20-\x7e]/g, ".");
      devLog(
        `[read_document] magic bytes hex=${hex} ascii="${ascii}" for filename="${docInfo.filename}"`,
      );
    }
    let text: string;
    if (docInfo.file_type === "pdf") {
      text = await extractPdfText(raw);
      devLog(
        `[read_document] pdf extracted length=${text.length} for filename="${docInfo.filename}"`,
      );
    } else if (docInfo.file_type === "docx") {
      // Use the same flattening as the edit_document matcher so the
      // LLM sees exactly the characters it can anchor against.
      text = await extractDocxBodyText(Buffer.from(raw));
      devLog(
        `[read_document] docx extractDocxBodyText length=${text.length} for filename="${docInfo.filename}"`,
      );
      if (!text) {
        devLog(
          `[read_document] docx accepted-view extractor returned empty, falling back to mammoth for filename="${docInfo.filename}"`,
        );
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({
          buffer: Buffer.from(raw),
        });
        text = result.value;
        devLog(
          `[read_document] docx mammoth fallback length=${text.length} for filename="${docInfo.filename}"`,
        );
      }
    } else {
      devLog(
        `[read_document] unknown file_type="${docInfo.file_type}" for filename="${docInfo.filename}", trying mammoth`,
      );
      const mammoth = await import("mammoth");
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(raw),
      });
      text = result.value;
      devLog(
        `[read_document] mammoth length=${text.length} for filename="${docInfo.filename}"`,
      );
    }
    devLog(
      `[read_document] DONE filename="${docInfo.filename}" finalTextLength=${text.length} firstChars=${JSON.stringify(text.slice(0, 120))}`,
    );
    emitDocRead();
    return text;
  } catch (err) {
    devLog(
      `[read_document] THREW for docLabel="${docLabel}" filename="${docInfo.filename}":`,
      err,
    );
    if (emitEvents)
      write(
        `data: ${JSON.stringify({ type: "doc_read", filename: docInfo.filename })}\n\n`,
      );
    return "Document could not be read.";
  }
}

/**
 * Build a whitespace-collapsed, lowercased copy of `text`, plus a map from
 * each character index in the normalized form back to the corresponding
 * index in the original text. Used by `findInDocumentContent` so matches
 * are tolerant of case + whitespace variance but can still return the
 * exact original excerpt.
 */
function normalizeWithMap(text: string): { norm: string; origIdx: number[] } {
  const norm: string[] = [];
  const origIdx: number[] = [];
  let prevSpace = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!prevSpace) {
        norm.push(" ");
        origIdx.push(i);
        prevSpace = true;
      }
    } else {
      norm.push(ch.toLowerCase());
      origIdx.push(i);
      prevSpace = false;
    }
  }
  return { norm: norm.join(""), origIdx };
}

function normalizeQuery(q: string): string {
  return q.trim().replace(/\s+/g, " ").toLowerCase();
}

type TextMatch = {
  index: number;
  excerpt: string;
  context: string;
};

function findTextMatches(params: {
  text: string;
  query: string;
  maxResults: number;
  contextChars: number;
  startIndex?: number;
}): { hits: TextMatch[]; totalMatches: number } {
  const { text, query, maxResults, contextChars, startIndex = 0 } = params;
  const { norm, origIdx } = normalizeWithMap(text);
  const needle = normalizeQuery(query);
  const hits: TextMatch[] = [];
  let totalMatches = 0;
  if (!needle) return { hits, totalMatches };

  let from = 0;
  while (from <= norm.length - needle.length) {
    const pos = norm.indexOf(needle, from);
    if (pos < 0) break;
    const endNormPos = pos + needle.length;
    const origStart = origIdx[pos] ?? 0;
    const origEnd =
      endNormPos - 1 < origIdx.length
        ? origIdx[endNormPos - 1] + 1
        : text.length;
    if (hits.length < maxResults) {
      const ctxStart = Math.max(0, origStart - contextChars);
      const ctxEnd = Math.min(text.length, origEnd + contextChars);
      hits.push({
        index: startIndex + hits.length,
        excerpt: text.slice(origStart, origEnd),
        context:
          (ctxStart > 0 ? "…" : "") +
          text.slice(ctxStart, ctxEnd).replace(/\s+/g, " ").trim() +
          (ctxEnd < text.length ? "…" : ""),
      });
    }
    totalMatches++;
    from = pos + Math.max(1, needle.length);
  }

  return { hits, totalMatches };
}

/**
 * Ctrl+F helper. Returns a JSON-serializable result with up to `maxResults`
 * hits, each containing the original-text excerpt plus surrounding context.
 */
async function findInDocumentContent(params: {
  docLabel: string;
  query: string;
  maxResults?: number;
  contextChars?: number;
  docStore: DocStore;
  write: (s: string) => void;
  docIndex?: DocIndex;
  db?: ReturnType<typeof createServerSupabase>;
}): Promise<string> {
  const {
    docLabel,
    query,
    maxResults = 20,
    contextChars = 80,
    docStore,
    write,
    docIndex,
    db,
  } = params;

  if (!query || !query.trim()) {
    return JSON.stringify({ ok: false, error: "Empty query." });
  }

  const docInfo = docStore.get(docLabel);
  if (!docInfo) {
    return JSON.stringify({
      ok: false,
      error: `Document '${docLabel}' not found.`,
    });
  }

  // Announce the search to the UI, then reuse readDocumentContent for its
  // fallbacks — but suppress its own doc_read events so the user only sees
  // the doc_find block (not a competing doc_read block for the same op).
  write(
    `data: ${JSON.stringify({
      type: "doc_find_start",
      filename: docInfo.filename,
      query,
    })}\n\n`,
  );

  const text = await readDocumentContent(
    docLabel,
    docStore,
    write,
    docIndex,
    db,
    { emitEvents: false },
  );
  if (!text || text === "Document could not be read.") {
    write(
      `data: ${JSON.stringify({
        type: "doc_find",
        filename: docInfo.filename,
        query,
        total_matches: 0,
      })}\n\n`,
    );
    return JSON.stringify({
      ok: false,
      filename: docInfo.filename,
      error: "Document could not be read.",
    });
  }

  const needle = normalizeQuery(query);
  if (!needle) {
    return JSON.stringify({
      ok: false,
      error: "Empty query after normalization.",
    });
  }

  const { hits, totalMatches } = findTextMatches({
    text,
    query,
    maxResults,
    contextChars,
  });

  write(
    `data: ${JSON.stringify({
      type: "doc_find",
      filename: docInfo.filename,
      query,
      total_matches: totalMatches,
    })}\n\n`,
  );

  return JSON.stringify({
    ok: true,
    filename: docInfo.filename,
    query,
    total_matches: totalMatches,
    returned: hits.length,
    truncated: totalMatches > hits.length,
    hits,
  });
}

export type DocEditedResult = {
  filename: string;
  document_id: string;
  version_id: string;
  version_number: number | null;
  download_url: string;
  annotations: EditAnnotation[];
};

export type TurnEditState = Map<
  string,
  { versionId: string; versionNumber: number; storagePath: string }
>;

export type DocCreatedResult = {
  filename: string;
  download_url: string;
  document_id?: string;
  version_id?: string;
  version_number?: number | null;
};

export type DocReplicatedResult = {
  /** Filename of the source document being copied. */
  filename: string;
  /** How many copies were produced in this single tool call. */
  count: number;
  /** One entry per new copy. */
  copies: {
    new_filename: string;
    document_id: string;
    version_id: string;
  }[];
};

type CourtlistenerCaseRecord = {
  clusterId: number;
  caseName: string | null;
  citations: string[];
  url: string | null;
  pdfUrl: string | null;
  dateFiled: string | null;
  opinions?: unknown[];
};

type CourtlistenerCaseInput = {
  clusterId?: number | null;
  caseName?: string | null;
  citation?: string | null;
  citations?: string[];
  url?: string | null;
  pdfUrl?: string | null;
  dateFiled?: string | null;
  opinions?: unknown[];
};

type CourtlistenerTurnState = {
  casesByClusterId: Map<number, CourtlistenerCaseRecord>;
};

function nonEmpty(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function upsertCourtlistenerCases(
  state: CourtlistenerTurnState,
  inputs: CourtlistenerCaseInput[],
): CourtlistenerCaseRecord[] {
  const records: CourtlistenerCaseRecord[] = [];
  for (const input of inputs) {
    if (typeof input.clusterId !== "number" || !Number.isFinite(input.clusterId)) {
      continue;
    }
    const clusterId = Math.floor(input.clusterId);
    const current =
      state.casesByClusterId.get(clusterId) ??
      {
        clusterId,
        caseName: null,
        citations: [],
        url: null,
        pdfUrl: null,
        dateFiled: null,
      };
    const nextCitations = [
      ...current.citations,
      ...(input.citation ? [input.citation] : []),
      ...(input.citations ?? []),
    ]
      .map(nonEmpty)
      .filter((value): value is string => !!value);
    const record: CourtlistenerCaseRecord = {
      ...current,
      caseName: current.caseName ?? nonEmpty(input.caseName),
      citations: Array.from(new Set(nextCitations)),
      url: current.url ?? nonEmpty(input.url),
      pdfUrl: current.pdfUrl ?? nonEmpty(input.pdfUrl),
      dateFiled: current.dateFiled ?? nonEmpty(input.dateFiled),
      opinions: current.opinions ?? input.opinions,
    };
    state.casesByClusterId.set(clusterId, record);
    records.push(record);
  }
  return records;
}

function caseCitationEventFromRecord(
  record: CourtlistenerCaseRecord,
): CaseCitationEvent | null {
  if (!record.url) return null;
  return {
    type: "case_citation",
    cluster_id: record.clusterId,
    case_name: record.caseName,
    citation: record.citations[0] ?? null,
    url: record.url,
    pdfUrl: record.pdfUrl,
    dateFiled: record.dateFiled,
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringField(
  record: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = record?.[key];
  return typeof value === "string" ? value : null;
}

function numberField(
  record: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.floor(value)
    : null;
}

function stringArrayField(
  record: Record<string, unknown> | null,
  key: string,
): string[] {
  const value = record?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function courtlistenerCaseInputFromFetchedCase(
  fallbackClusterId: number,
  fetchedCase: unknown,
): CourtlistenerCaseInput {
  const record = recordFromUnknown(fetchedCase);
  const clusterId =
    numberField(record, "clusterId") ?? numberField(record, "id") ?? fallbackClusterId;
  return {
    clusterId,
    caseName: stringField(record, "caseName"),
    citations: stringArrayField(record, "citations"),
    url: stringField(record, "url"),
    pdfUrl: stringField(record, "pdfUrl"),
    dateFiled: stringField(record, "dateFiled"),
    opinions: Array.isArray(record?.opinions) ? record.opinions : undefined,
  };
}

function courtlistenerOpinionCount(fetchedCase: unknown): number {
  const record = recordFromUnknown(fetchedCase);
  return Array.isArray(record?.opinions) ? record.opinions.length : 0;
}

function courtlistenerOpinionMetadata(raw: unknown) {
  const opinion = recordFromUnknown(raw);
  if (!opinion) return null;
  const text =
    stringField(opinion, "text") ??
    (stringField(opinion, "html")
      ? stripCaseOpinionHtml(stringField(opinion, "html")!)
      : null);
  return {
    opinion_id:
      numberField(opinion, "opinionId") ?? numberField(opinion, "id"),
    type: stringField(opinion, "type"),
    author: stringField(opinion, "author"),
    per_curiam: stringField(opinion, "per_curiam"),
    joined_by_str: stringField(opinion, "joined_by_str"),
    url: stringField(opinion, "url"),
    char_count: text?.length ?? 0,
  };
}

function courtlistenerFetchedCaseMetadata(
  record: CourtlistenerCaseRecord,
  opinionCount: number,
) {
  return {
    cluster_id: record.clusterId,
    case_name: record.caseName,
    citation: record.citations[0] ?? null,
    citations: record.citations,
    dateFiled: record.dateFiled,
    url: record.url,
    pdfUrl: record.pdfUrl,
    opinion_count: opinionCount,
    opinions: (record.opinions ?? [])
      .map(courtlistenerOpinionMetadata)
      .filter((opinion): opinion is NonNullable<typeof opinion> => !!opinion),
  };
}

function stripCaseOpinionHtml(value: string): string {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

type CachedCaseOpinionText = {
  opinion_id: number | null;
  type: string | null;
  author: string | null;
  url: string | null;
  text: string;
};

function cachedCaseOpinionTexts(
  record: CourtlistenerCaseRecord,
): CachedCaseOpinionText[] {
  return (record.opinions ?? [])
    .map((raw) => {
      const opinion = recordFromUnknown(raw);
      if (!opinion) return null;
      const text =
        stringField(opinion, "text") ??
        (stringField(opinion, "html")
          ? stripCaseOpinionHtml(stringField(opinion, "html")!)
          : null);
      if (!text) return null;
      return {
        opinion_id:
          numberField(opinion, "opinionId") ?? numberField(opinion, "id"),
        type: stringField(opinion, "type"),
        author: stringField(opinion, "author"),
        url: stringField(opinion, "url"),
        text,
      };
    })
    .filter((opinion): opinion is CachedCaseOpinionText => !!opinion);
}

function requestedCourtlistenerOpinionIds(args: Record<string, unknown>) {
  const rawIds = Array.isArray(args.opinionIds)
    ? args.opinionIds
    : Array.isArray(args.opinion_ids)
      ? args.opinion_ids
      : typeof args.opinionId === "number"
        ? [args.opinionId]
        : typeof args.opinion_id === "number"
          ? [args.opinion_id]
          : [];
  return Array.from(
    new Set(
      rawIds
        .filter((value): value is number => typeof value === "number")
        .filter((value) => Number.isFinite(value) && value > 0)
        .map((value) => Math.floor(value)),
    ),
  );
}

type FindInCaseArgs = {
  clusterId: number | null;
  query: string;
  maxResults: number;
  contextChars: number;
};

function parseFindInCaseArgs(args: Record<string, unknown>): FindInCaseArgs {
  return {
    clusterId:
      typeof args.clusterId === "number" && Number.isFinite(args.clusterId)
        ? Math.floor(args.clusterId)
        : typeof args.cluster_id === "number" && Number.isFinite(args.cluster_id)
          ? Math.floor(args.cluster_id)
          : null,
    query: typeof args.query === "string" ? args.query : "",
    maxResults:
      typeof args.max_results === "number"
        ? Math.max(0, Math.floor(args.max_results))
        : 20,
    contextChars:
      typeof args.context_chars === "number"
        ? Math.max(0, Math.floor(args.context_chars))
        : 160,
  };
}

function findInCaseSearchSummary(
  event: Extract<CourtlistenerToolEvent, { type: "courtlistener_find_in_case" }>,
) {
  return {
    cluster_id: event.cluster_id,
    query: event.query,
    total_matches: event.total_matches,
    case_name: event.case_name,
    citation: event.citation,
    error: event.error,
  };
}

function cachedCaseNotFetchedResult(clusterId: number | null) {
  return {
    ok: false,
    cluster_id: clusterId,
    error:
      "Case has not been fetched in this turn. Call courtlistener_get_cases first.",
  };
}

export async function runToolCalls(
  toolCalls: ToolCall[],
  docStore: DocStore,
  userId: string,
  db: ReturnType<typeof createServerSupabase>,
  write: (s: string) => void,
  workflowStore?: WorkflowStore,
  tabularStore?: TabularCellStore,
  docIndex?: DocIndex,
  turnEditState?: TurnEditState,
  projectId?: string | null,
  courtlistenerState?: CourtlistenerTurnState,
  apiKeys?: import("./llm").UserApiKeys,
): Promise<{
  toolResults: unknown[];
  docsRead: { filename: string; document_id?: string }[];
  docsFound: { filename: string; query: string; total_matches: number }[];
  docsCreated: DocCreatedResult[];
  docsReplicated: DocReplicatedResult[];
  workflowsApplied: { workflow_id: string; title: string }[];
  docsEdited: DocEditedResult[];
  courtlistenerEvents: CourtlistenerToolEvent[];
  caseCitationEvents: CaseCitationEvent[];
  mcpEvents: McpToolEvent[];
}> {
  const toolResults: unknown[] = [];
  const docsRead: { filename: string; document_id?: string }[] = [];
  const docsFound: {
    filename: string;
    query: string;
    total_matches: number;
  }[] = [];
  const docsCreated: DocCreatedResult[] = [];
  const docsReplicated: DocReplicatedResult[] = [];
  const workflowsApplied: { workflow_id: string; title: string }[] = [];
  const docsEdited: DocEditedResult[] = [];
  const courtlistenerEvents: CourtlistenerToolEvent[] = [];
  const caseCitationEvents: CaseCitationEvent[] = [];
  const mcpEvents: McpToolEvent[] = [];
  const courtState: CourtlistenerTurnState =
    courtlistenerState ??
    {
      casesByClusterId: new Map(),
    };
  const groupedFindInCaseSearches = toolCalls
    .filter((tc) => tc.function.name === COURTLISTENER_TOOL_NAMES.findInCase)
    .map((tc) => {
      let rawArgs: Record<string, unknown> = {};
      try {
        rawArgs = JSON.parse(tc.function.arguments || "{}");
      } catch {
        /* ignore */
      }
      const parsed = parseFindInCaseArgs(rawArgs);
      return {
        cluster_id: parsed.clusterId,
        query: parsed.query,
        total_matches: 0,
      };
    });
  const shouldGroupFindInCase = groupedFindInCaseSearches.length > 1;
  let groupedFindInCaseStarted = false;
  const groupedFindInCaseEvents: Extract<
    CourtlistenerToolEvent,
    { type: "courtlistener_find_in_case" }
  >[] = [];

  for (const tc of toolCalls) {
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch {
      /* ignore */
    }

    if (tc.function.name.startsWith("mcp_")) {
      write(
        `data: ${JSON.stringify({
          type: "mcp_tool_start",
          name: tc.function.name,
        })}\n\n`,
      );
      const { content, event } = await executeMcpToolCall(
        userId,
        tc.function.name,
        args,
        db,
      );
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content,
      });
      mcpEvents.push(event);
      write(
        `data: ${JSON.stringify({
          type: "mcp_tool_result",
          name: tc.function.name,
          connector_name: event.connector_name,
          tool_name: event.tool_name,
          status: event.status,
          error: event.error,
        })}\n\n`,
      );
      continue;
    }

    if (tc.function.name === "read_document") {
      const rawDocId = args.doc_id as string;
      const docId = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
      const content = await readDocumentContent(
        docId,
        docStore,
        write,
        docIndex,
        db,
      );
      const filename = docStore.get(docId)?.filename;
      const documentId = docIndex?.[docId]?.document_id;
      if (filename) docsRead.push({ filename, document_id: documentId });
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: filename
          ? `${citationReminder(docId, filename)}\n\n${content}`
          : content,
      });
    } else if (tc.function.name === "find_in_document") {
      const rawDocId = args.doc_id as string;
      const docId = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
      const query = (args.query as string) ?? "";
      const maxResults =
        typeof args.max_results === "number" ? args.max_results : undefined;
      const contextChars =
        typeof args.context_chars === "number" ? args.context_chars : undefined;
      const content = await findInDocumentContent({
        docLabel: docId,
        query,
        maxResults,
        contextChars,
        docStore,
        write,
        docIndex,
        db,
      });
      const filename = docStore.get(docId)?.filename;
      if (filename) {
        let totalMatches = 0;
        try {
          const parsed = JSON.parse(content) as {
            total_matches?: number;
          };
          totalMatches = parsed.total_matches ?? 0;
        } catch {
          /* ignore — still record the find attempt */
        }
        docsFound.push({
          filename,
          query,
          total_matches: totalMatches,
        });
      }
      toolResults.push({ role: "tool", tool_call_id: tc.id, content });
    } else if (tc.function.name === "list_documents") {
      const list = Array.from(docStore.entries()).map(([doc_id, info]) => ({
        doc_id,
        filename: info.filename,
        file_type: info.file_type,
      }));
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(list),
      });
    } else if (tc.function.name === "fetch_documents") {
      const rawDocIds = (args.doc_ids as string[]) ?? [];
      const docIds = rawDocIds.map(
        (id) => resolveDocLabel(id, docStore, docIndex) ?? id,
      );
      const parts: string[] = [];
      for (const docId of docIds) {
        const content = await readDocumentContent(
          docId,
          docStore,
          write,
          docIndex,
          db,
        );
        const filename = docStore.get(docId)?.filename ?? docId;
        parts.push(
          `--- ${filename} (${docId}) ---\n${citationReminder(docId, filename)}\n\n${content}`,
        );
        if (docStore.get(docId)) {
          const documentId = docIndex?.[docId]?.document_id;
          docsRead.push({ filename, document_id: documentId });
        }
      }
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: parts.join("\n\n"),
      });
    } else if (tc.function.name === "list_workflows") {
      const list = workflowStore
        ? Array.from(workflowStore.entries()).map(([id, w]) => ({
            id,
            title: w.title,
          }))
        : [];
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(list),
      });
    } else if (tc.function.name === "read_workflow") {
      const wfId = args.workflow_id as string;
      const wf = workflowStore?.get(wfId);
      if (wf) {
        write(
          `data: ${JSON.stringify({ type: "workflow_applied", workflow_id: wfId, title: wf.title })}\n\n`,
        );
        workflowsApplied.push({ workflow_id: wfId, title: wf.title });
      }
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: wf ? wf.prompt_md : `Workflow '${wfId}' not found.`,
      });
    } else if (tc.function.name === "read_table_cells" && tabularStore) {
      const colIndices = args.col_indices as number[] | undefined;
      const rowIndices = args.row_indices as number[] | undefined;

      const filteredCols = colIndices?.length
        ? tabularStore.columns.filter((_, i) => colIndices.includes(i))
        : tabularStore.columns;
      const filteredDocs = rowIndices?.length
        ? tabularStore.documents.filter((_, i) => rowIndices.includes(i))
        : tabularStore.documents;

      const label = `${filteredCols.length} ${filteredCols.length === 1 ? "column" : "columns"} × ${filteredDocs.length} ${filteredDocs.length === 1 ? "row" : "rows"}`;
      write(
        `data: ${JSON.stringify({ type: "doc_read_start", filename: label })}\n\n`,
      );

      const lines: string[] = [];
      for (const col of filteredCols) {
        const colPos = tabularStore.columns.findIndex(
          (c) => c.index === col.index,
        );
        for (const doc of filteredDocs) {
          const rowPos = tabularStore.documents.findIndex(
            (d) => d.id === doc.id,
          );
          const cell = tabularStore.cells.get(`${col.index}:${doc.id}`);
          lines.push(
            `[COL:${colPos} "${col.name}" | ROW:${rowPos} "${doc.filename}"]`,
          );
          if (cell?.summary) {
            lines.push(`Summary: ${cell.summary}`);
            if (cell.flag) lines.push(`Flag: ${cell.flag}`);
            if (cell.reasoning) lines.push(`Reasoning: ${cell.reasoning}`);
          } else {
            lines.push(`(not yet generated)`);
          }
          lines.push("");
        }
      }

      write(
        `data: ${JSON.stringify({ type: "doc_read", filename: label })}\n\n`,
      );
      docsRead.push({ filename: label });
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: lines.join("\n") || "No cells found.",
      });
    } else if (tc.function.name === COURTLISTENER_TOOL_NAMES.searchCaseLaw) {
      const query = typeof args.query === "string" ? args.query : "";
      write(
        `data: ${JSON.stringify({ type: "courtlistener_search_case_law_start", query })}\n\n`,
      );
      try {
        const result = await searchCourtlistenerCaseLaw({
          query: query || undefined,
          court: typeof args.court === "string" ? args.court : undefined,
          filedAfter:
            typeof args.filedAfter === "string" ? args.filedAfter : undefined,
          filedBefore:
            typeof args.filedBefore === "string" ? args.filedBefore : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
          apiToken: apiKeys?.courtlistener,
        });
        const resultCount =
          result &&
          typeof result === "object" &&
          Array.isArray((result as { results?: unknown }).results)
            ? (result as { results: unknown[] }).results.length
            : 0;
        const error =
          result &&
          typeof result === "object" &&
          typeof (result as { error?: unknown }).error === "string"
            ? (result as { error: string }).error
            : undefined;
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_search_case_law",
          query,
          result_count: resultCount,
          ...(error ? { error } : {}),
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_search_case_law",
          query,
          result_count: 0,
          error:
            err instanceof Error ? err.message : "CourtListener search failed.",
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            error:
              err instanceof Error
                ? err.message
                : "CourtListener search failed.",
          }),
        });
      }
    } else if (tc.function.name === COURTLISTENER_TOOL_NAMES.getCases) {
      const rawClusterIds = Array.isArray(args.clusterIds)
        ? args.clusterIds
        : Array.isArray(args.cluster_ids)
          ? args.cluster_ids
          : typeof args.clusterId === "number"
            ? [args.clusterId]
            : [];
      const clusterIds = Array.from(
        new Set(
          rawClusterIds
            .filter((value): value is number => typeof value === "number")
            .filter((value) => Number.isFinite(value) && value > 0)
            .map((value) => Math.floor(value)),
        ),
      );
      write(
        `data: ${JSON.stringify({ type: "courtlistener_get_cases_start", cluster_ids: clusterIds })}\n\n`,
      );
      try {
        const result = await getCourtlistenerCases({
          clusterIds,
          db,
          apiToken: apiKeys?.courtlistener,
        });
        const fetchedCases =
          result &&
          typeof result === "object" &&
          Array.isArray((result as { cases?: unknown }).cases)
            ? (result as { cases: unknown[] }).cases
            : [];
        fetchedCases.forEach((fetchedCase, index) => {
          const clusterId =
            courtlistenerCaseInputFromFetchedCase(
              clusterIds[index] ?? 0,
              fetchedCase,
            ).clusterId ?? 0;
          if (clusterId) {
            write(
              `data: ${JSON.stringify({ type: "case_opinions", cluster_id: clusterId, case: fetchedCase })}\n\n`,
            );
          }
        });
        const caseRecords = upsertCourtlistenerCases(
          courtState,
          fetchedCases.map((fetchedCase, index) =>
            courtlistenerCaseInputFromFetchedCase(
              clusterIds[index] ?? 0,
              fetchedCase,
            ),
          ),
        );
        const opinionCount = fetchedCases.reduce<number>(
          (sum, fetchedCase) => sum + courtlistenerOpinionCount(fetchedCase),
          0,
        );
        const caseOpinionCountByClusterId = new Map<number, number>();
        fetchedCases.forEach((fetchedCase, index) => {
          const clusterId =
            courtlistenerCaseInputFromFetchedCase(
              clusterIds[index] ?? 0,
              fetchedCase,
            ).clusterId ?? 0;
          if (clusterId) {
            caseOpinionCountByClusterId.set(
              clusterId,
              courtlistenerOpinionCount(fetchedCase),
            );
          }
        });
        const errors = fetchedCases
          .map((fetchedCase) =>
            stringField(recordFromUnknown(fetchedCase), "error"),
          )
          .filter((error): error is string => !!error);
        const resultError =
          result &&
          typeof result === "object" &&
          typeof (result as { error?: unknown }).error === "string"
            ? (result as { error: string }).error
            : undefined;
        const hasMultipleOpinionCase = caseRecords.some(
          (record) =>
            (caseOpinionCountByClusterId.get(record.clusterId) ?? 0) > 1,
        );
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_get_cases",
          cluster_ids: clusterIds,
          case_count: fetchedCases.length,
          opinion_count: opinionCount,
          cases: caseRecords.map((record) => ({
            cluster_id: record.clusterId,
            case_name: record.caseName,
            citation: record.citations[0] ?? null,
            dateFiled: record.dateFiled,
            url: record.url,
          })),
          ...(resultError || errors.length
            ? { error: resultError ?? errors.join("; ") }
            : {}),
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            ok: !resultError && errors.length === 0,
            cluster_ids: clusterIds,
            case_count: fetchedCases.length,
            opinion_count: opinionCount,
            cases: caseRecords.map((record) =>
              courtlistenerFetchedCaseMetadata(
                record,
                caseOpinionCountByClusterId.get(record.clusterId) ?? 0,
              ),
            ),
            ...(resultError || errors.length
              ? { error: resultError ?? errors.join("; ") }
              : {}),
            next_required_action: hasMultipleOpinionCase
              ? "Opinion text is cached server-side only. Use courtlistener_find_in_case with short 1-3 word keyword probes for relevant passages. At least one fetched case has multiple opinions; if snippets are insufficient, choose the needed opinion_id(s) from the text-free opinion metadata and call courtlistener_read_case with only those IDs. Do not read all opinions unless the question requires it."
              : "Opinion text is cached server-side only. Use courtlistener_find_in_case with short 1-3 word keyword probes for relevant passages, or courtlistener_read_case if snippets are insufficient.",
          }),
        });
      } catch (err) {
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_get_cases",
          cluster_ids: clusterIds,
          case_count: 0,
          opinion_count: 0,
          error:
            err instanceof Error
              ? err.message
              : "CourtListener case fetch failed.",
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            error:
              err instanceof Error
                ? err.message
                : "CourtListener case fetch failed.",
          }),
        });
      }
    } else if (tc.function.name === COURTLISTENER_TOOL_NAMES.findInCase) {
      const { clusterId, query, maxResults, contextChars } =
        parseFindInCaseArgs(args);
      if (shouldGroupFindInCase) {
        if (!groupedFindInCaseStarted) {
          write(
            `data: ${JSON.stringify({
              type: "courtlistener_find_in_case_start",
              cluster_id: null,
              query: "",
              searches: groupedFindInCaseSearches,
            })}\n\n`,
          );
          groupedFindInCaseStarted = true;
        }
      } else {
        write(
          `data: ${JSON.stringify({ type: "courtlistener_find_in_case_start", cluster_id: clusterId, query })}\n\n`,
        );
      }

      const record =
        typeof clusterId === "number" ? courtState.casesByClusterId.get(clusterId) : undefined;
      if (!record) {
        const payload = cachedCaseNotFetchedResult(clusterId);
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_find_in_case",
          cluster_id: clusterId,
          query,
          total_matches: 0,
          error: payload.error,
        };
        if (shouldGroupFindInCase) {
          groupedFindInCaseEvents.push(event);
        } else {
          write(`data: ${JSON.stringify(event)}\n\n`);
          courtlistenerEvents.push(event);
        }
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(payload),
        });
        continue;
      }

      const opinions = cachedCaseOpinionTexts(record);
      const hits: Array<
        TextMatch & {
          opinion_id: number | null;
          type: string | null;
          author: string | null;
          url: string | null;
        }
      > = [];
      let totalMatches = 0;
      for (const opinion of opinions) {
        const remaining = Math.max(0, maxResults - hits.length);
        const result = findTextMatches({
          text: opinion.text,
          query,
          maxResults: remaining,
          contextChars,
          startIndex: hits.length,
        });
        totalMatches += result.totalMatches;
        hits.push(
          ...result.hits.map((hit) => ({
            ...hit,
            opinion_id: opinion.opinion_id,
            type: opinion.type,
            author: opinion.author,
            url: opinion.url,
          })),
        );
      }

      const event: CourtlistenerToolEvent = {
        type: "courtlistener_find_in_case",
        cluster_id: record.clusterId,
        query,
        total_matches: totalMatches,
        case_name: record.caseName,
        citation: record.citations[0] ?? null,
      };
      if (shouldGroupFindInCase) {
        groupedFindInCaseEvents.push(event);
      } else {
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
      }
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({
          ok: true,
          cluster_id: record.clusterId,
          case_name: record.caseName,
          citation: record.citations[0] ?? null,
          query,
          total_matches: totalMatches,
          returned: hits.length,
          truncated: totalMatches > hits.length,
          hits,
        }),
      });
    } else if (tc.function.name === COURTLISTENER_TOOL_NAMES.readCase) {
      const clusterId =
        typeof args.clusterId === "number" && Number.isFinite(args.clusterId)
          ? Math.floor(args.clusterId)
          : typeof args.cluster_id === "number" &&
              Number.isFinite(args.cluster_id)
            ? Math.floor(args.cluster_id)
            : null;
      write(
        `data: ${JSON.stringify({ type: "courtlistener_read_case_start", cluster_id: clusterId })}\n\n`,
      );

      const record =
        typeof clusterId === "number" ? courtState.casesByClusterId.get(clusterId) : undefined;
      if (!record) {
        const payload = cachedCaseNotFetchedResult(clusterId);
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_read_case",
          cluster_id: clusterId,
          opinion_count: 0,
          error: payload.error,
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(payload),
        });
        continue;
      }

      const opinions = cachedCaseOpinionTexts(record);
      const requestedOpinionIds = requestedCourtlistenerOpinionIds(args);
      const selectedOpinions =
        requestedOpinionIds.length > 0
          ? opinions.filter(
              (opinion) =>
                typeof opinion.opinion_id === "number" &&
                requestedOpinionIds.includes(opinion.opinion_id),
            )
          : opinions.length === 1
            ? opinions
            : [];
      if (!selectedOpinions.length) {
        const multipleOpinions = opinions.length > 1;
        const payload = {
          ok: false,
          cluster_id: record.clusterId,
          case_name: record.caseName,
          citations: record.citations,
          url: record.url,
          dateFiled: record.dateFiled,
          opinion_count: opinions.length,
          opinions: (record.opinions ?? [])
            .map(courtlistenerOpinionMetadata)
            .filter(
              (opinion): opinion is NonNullable<typeof opinion> =>
                !!opinion,
            ),
          error: multipleOpinions
            ? "Multiple opinions are available. Call courtlistener_read_case again with the opinionId or opinionIds needed."
            : "No matching opinion_id was found for this fetched case.",
        };
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_read_case",
          cluster_id: record.clusterId,
          case_name: record.caseName,
          citation: record.citations[0] ?? null,
          opinion_count: 0,
          error: payload.error,
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(payload),
        });
        continue;
      }

      const event: CourtlistenerToolEvent = {
        type: "courtlistener_read_case",
        cluster_id: record.clusterId,
        case_name: record.caseName,
        citation: record.citations[0] ?? null,
        opinion_count: selectedOpinions.length,
      };
      write(`data: ${JSON.stringify(event)}\n\n`);
      courtlistenerEvents.push(event);
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify({
          ok: true,
          cluster_id: record.clusterId,
          case_name: record.caseName,
          citations: record.citations,
          url: record.url,
          dateFiled: record.dateFiled,
          opinion_count: opinions.length,
          returned_opinion_count: selectedOpinions.length,
          opinions: selectedOpinions,
        }),
      });
    } else if (tc.function.name === COURTLISTENER_TOOL_NAMES.verifyCitations) {
      const citations = Array.isArray(args.citations)
        ? args.citations.filter(
            (value): value is string => typeof value === "string",
          )
        : [];
      const citationCount = citations.length;
      write(
        `data: ${JSON.stringify({ type: "courtlistener_verify_citations_start", citation_count: citationCount })}\n\n`,
      );
      try {
        const result = (await verifyCourtlistenerCitations({
          citations,
          db,
          apiToken: apiKeys?.courtlistener,
        })) as {
          citationLinks?: {
            clusterId?: number | null;
            citation?: string | null;
            caseName?: string | null;
            dateFiled?: string | null;
            pdfUrl?: string | null;
            url?: string | null;
            markdown?: string;
          }[];
          results?: unknown[];
          error?: string;
          source?: string;
          [key: string]: unknown;
        };
        if (Array.isArray(result.citationLinks)) {
          const caseRecords = upsertCourtlistenerCases(
            courtState,
            result.citationLinks.map((link) => ({
              clusterId: link.clusterId,
              caseName: link.caseName,
              citation: link.citation,
              url: link.url,
              pdfUrl: link.pdfUrl,
              dateFiled: link.dateFiled,
            })),
          );
          const recordsByClusterId = new Map(
            caseRecords.map((record) => [record.clusterId, record]),
          );
          result.citationLinks = result.citationLinks.map((link) => {
            if (!link.url) return link;
            const href =
              typeof link.clusterId === "number"
                ? `us-case-${link.clusterId}`
                : link.url;
            const label = [link.caseName, link.citation]
              .filter(Boolean)
              .join(", ");
            const record =
              typeof link.clusterId === "number"
                ? recordsByClusterId.get(link.clusterId)
                : undefined;
            if (record) {
              const event = caseCitationEventFromRecord(record);
              if (event) {
                caseCitationEvents.push(event);
                write(`data: ${JSON.stringify(event)}\n\n`);
              }
            }
            return {
              ...link,
              markdown: `[${label || link.url}](${href})`,
            };
          });
        }
        const rows =
          result &&
          typeof result === "object" &&
          Array.isArray((result as { results?: unknown }).results)
            ? (result as { results: unknown[] }).results
            : [];
        const matchCount = rows.reduce<number>((count, row) => {
          if (!row || typeof row !== "object") return count;
          const clusters = (row as { clusters?: unknown }).clusters;
          return count + (Array.isArray(clusters) ? clusters.length : 0);
        }, 0);
        const error =
          result &&
          typeof result === "object" &&
          typeof (result as { error?: unknown }).error === "string"
            ? (result as { error: string }).error
            : undefined;
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_verify_citations",
          citation_count: citationCount,
          match_count: matchCount,
          ...(error ? { error } : {}),
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const event: CourtlistenerToolEvent = {
          type: "courtlistener_verify_citations",
          citation_count: citationCount,
          match_count: 0,
          error:
            err instanceof Error
              ? err.message
              : "CourtListener citation lookup failed.",
        };
        write(`data: ${JSON.stringify(event)}\n\n`);
        courtlistenerEvents.push(event);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({
            error:
              err instanceof Error
                ? err.message
                : "CourtListener citation lookup failed.",
          }),
        });
      }
    } else if (tc.function.name === "edit_document" && docIndex) {
      const rawDocId = args.doc_id as string;
      const editsRaw = args.edits as unknown[] | undefined;
      const docId = resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
      const docInfo = docStore.get(docId);
      const indexed = docIndex?.[docId];

      const emitEditError = (
        filename: string,
        documentId: string,
        error: string,
      ) => {
        // Surface the failure as a failed "Edited" block in the UI
        // (start → done-with-error) so it matches the shape the
        // success/late-failure paths already use.
        write(
          `data: ${JSON.stringify({
            type: "doc_edited_start",
            filename,
          })}\n\n`,
        );
        write(
          `data: ${JSON.stringify({
            type: "doc_edited",
            filename,
            document_id: documentId,
            version_id: "",
            download_url: "",
            annotations: [],
            error,
          })}\n\n`,
        );
      };

      if (!docInfo || !indexed) {
        const err = `Document '${docId}' not found in this chat's attachments.`;
        emitEditError(docId, indexed?.document_id ?? "", err);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err }),
        });
      } else if (!Array.isArray(editsRaw) || editsRaw.length === 0) {
        const err = "edits array is required and must not be empty.";
        emitEditError(docInfo.filename, indexed.document_id, err);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err }),
        });
      } else if (docInfo.file_type !== "docx") {
        const err = "edit_document only supports .docx files.";
        emitEditError(docInfo.filename, indexed.document_id, err);
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ error: err }),
        });
      } else {
        write(
          `data: ${JSON.stringify({
            type: "doc_edited_start",
            filename: docInfo.filename,
          })}\n\n`,
        );
        const edits: EditInput[] = (editsRaw as Record<string, unknown>[]).map(
          (e) => ({
            find: String(e.find ?? ""),
            replace: String(e.replace ?? ""),
            context_before: String(e.context_before ?? ""),
            context_after: String(e.context_after ?? ""),
            reason: e.reason ? String(e.reason) : undefined,
          }),
        );
        const reuseVersion = turnEditState?.get(indexed.document_id);
        const result = await runEditDocument({
          documentId: indexed.document_id,
          userId,
          edits,
          db,
          reuseVersion,
        });

        if (result.ok) {
          turnEditState?.set(indexed.document_id, {
            versionId: result.version_id,
            versionNumber: result.version_number,
            storagePath: result.storage_path,
          });
          // Keep the chat-local doc label pointed at the latest
          // edited version so any follow-up read_document call in
          // the same assistant turn reads and cites the same bytes.
          if (docIndex[docId]) {
            docIndex[docId] = {
              ...docIndex[docId],
              version_id: result.version_id,
              version_number: result.version_number,
            };
          }
          const currentDocStore = docStore.get(docId);
          if (currentDocStore) {
            docStore.set(docId, {
              ...currentDocStore,
              storage_path: result.storage_path,
            });
          }
          const payload: DocEditedResult = {
            filename: docInfo.filename,
            document_id: indexed.document_id,
            version_id: result.version_id,
            version_number: result.version_number,
            download_url: result.download_url,
            annotations: result.annotations,
          };
          docsEdited.push(payload);
          write(
            `data: ${JSON.stringify({
              type: "doc_edited",
              ...payload,
            })}\n\n`,
          );
          toolResults.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: true,
              doc_id: docId,
              document_id: indexed.document_id,
              version_id: result.version_id,
              version_number: result.version_number,
              applied: result.annotations.length,
              errors: result.errors,
              next_required_action: [
                `The edited document remains available as doc_id "${docId}".`,
                `Before making factual claims about the edited document's final contents, call read_document with doc_id "${docId}" and base the response on that returned text.`,
                `Do not include download links or URLs in your prose response; the edited document card is shown automatically by the UI.`,
                `If you describe specific content from the edited document, cite it with [N] markers and a final <CITATIONS> block using doc_id "${docId}".`,
              ].join(" "),
            }),
          });
        } else {
          write(
            `data: ${JSON.stringify({
              type: "doc_edited",
              filename: docInfo.filename,
              document_id: indexed.document_id,
              version_id: "",
              download_url: "",
              annotations: [],
              error: result.error,
            })}\n\n`,
          );
          toolResults.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify({
              ok: false,
              error: result.error,
            }),
          });
        }
      }
    } else if (tc.function.name === "replicate_document" && docIndex) {
      const rawDocId = args.doc_id as string;
      const requestedFilename =
        typeof args.new_filename === "string" && args.new_filename.trim()
          ? args.new_filename.trim()
          : null;
      const requestedCount =
        typeof args.count === "number" && Number.isFinite(args.count)
          ? Math.max(1, Math.min(20, Math.floor(args.count)))
          : 1;
      const sourceLabel =
        resolveDocLabel(rawDocId, docStore, docIndex) ?? rawDocId;
      const sourceInfo = docStore.get(sourceLabel);
      const sourceIndexed = docIndex[sourceLabel];
      const sourceFilename = sourceInfo?.filename ?? rawDocId;

      write(
        `data: ${JSON.stringify({
          type: "doc_replicate_start",
          filename: sourceFilename,
          count: requestedCount,
        })}\n\n`,
      );

      const fail = (error: string) => {
        write(
          `data: ${JSON.stringify({
            type: "doc_replicated",
            filename: sourceFilename,
            count: requestedCount,
            copies: [],
            error,
          })}\n\n`,
        );
        toolResults.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify({ ok: false, error }),
        });
      };

      if (!sourceInfo || !sourceIndexed) {
        fail(`Document '${rawDocId}' not found in this project.`);
      } else if (!projectId) {
        fail("replicate_document is only available in project chats.");
      } else {
        try {
          // Pull the active version once — every copy gets the
          // same starting bytes (with any accepted tracked
          // changes rolled in), no point re-fetching per copy.
          const active = await loadActiveVersion(sourceIndexed.document_id, db);
          const sourcePath = active?.storage_path ?? sourceInfo.storage_path;
          const sourcePdfPath = active?.pdf_storage_path ?? null;
          const raw = await downloadFile(sourcePath);
          const pdfBytes = sourcePdfPath
            ? await downloadFile(sourcePdfPath)
            : null;
          if (!raw) {
            fail("Could not read the source document's bytes from storage.");
          } else {
            // Build N filenames. With count=1 keep the
            // pre-existing "(copy)" suffix; with count>1 use
            // numbered "(1)", "(2)" suffixes.
            const srcExt = sourceInfo.filename.match(/\.[^./\\]+$/)?.[0] ?? "";
            const baseStem = (() => {
              if (requestedFilename) {
                return requestedFilename.replace(/\.[^./\\]+$/, "");
              }
              return sourceInfo.filename.replace(/\.[^./\\]+$/, "");
            })();
            const filenames: string[] = [];
            for (let n = 1; n <= requestedCount; n++) {
              const suffix =
                requestedCount === 1
                  ? requestedFilename
                    ? ""
                    : " (copy)"
                  : ` (${n})`;
              filenames.push(`${baseStem}${suffix}${srcExt}`);
            }

            // Bulk insert N documents in one round-trip.
            const docRows = filenames.map((fn) => ({
              project_id: projectId,
              user_id: userId,
              status: "ready",
            }));
            const { data: insertedDocs, error: docErr } = await db
              .from("documents")
              .insert(docRows)
              .select("id");
            if (docErr || !insertedDocs || insertedDocs.length === 0) {
              fail(
                `Failed to record replicated documents: ${docErr?.message ?? "unknown"}`,
              );
            } else {
              // Preserve the request order so each row pairs
              // with the right filename. Supabase returns
              // inserted rows in the same order as the
              // payload.
              const newDocs = (insertedDocs as { id: string }[]).map(
                (doc, idx) => ({
                  ...doc,
                  filename: filenames[idx] ?? "Untitled document.docx",
                }),
              );
              const contentType =
                sourceInfo.file_type === "pdf"
                  ? "application/pdf"
                  : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

              // Parallel uploads: the doc bytes (and PDF
              // rendition if any) for every new copy.
              const uploadJobs: Promise<unknown>[] = [];
              const newKeys: string[] = [];
              const newPdfKeys: (string | null)[] = [];
              for (const d of newDocs) {
                const key = storageKey(userId, d.id, d.filename);
                newKeys.push(key);
                uploadJobs.push(uploadFile(key, raw, contentType));
                if (pdfBytes) {
                  const pdfKey = convertedPdfKey(userId, d.id);
                  newPdfKeys.push(pdfKey);
                  uploadJobs.push(
                    uploadFile(pdfKey, pdfBytes, "application/pdf"),
                  );
                } else {
                  newPdfKeys.push(null);
                }
              }
              await Promise.all(uploadJobs);

              // Bulk insert N versions in one round-trip.
              const versionRows = newDocs.map((d, idx) => ({
                document_id: d.id,
                storage_path: newKeys[idx],
                pdf_storage_path: newPdfKeys[idx],
                source: "upload",
                version_number: 1,
                filename: d.filename,
                file_type: active?.file_type ?? sourceInfo.file_type,
                size_bytes: active?.size_bytes ?? raw.byteLength,
                page_count: active?.page_count ?? null,
                content_sha256: contentSha256(raw),
              }));
              const { data: insertedVersions, error: verErr } = await db
                .from("document_versions")
                .insert(versionRows)
                .select("id, document_id");
              if (
                verErr ||
                !insertedVersions ||
                insertedVersions.length !== newDocs.length
              ) {
                fail(
                  `Failed to record replicated document versions: ${verErr?.message ?? "unknown"}`,
                );
              } else {
                const versionByDocId = new Map<string, string>();
                for (const v of insertedVersions as {
                  id: string;
                  document_id: string;
                }[]) {
                  versionByDocId.set(v.document_id, v.id);
                }

                // current_version_id has to be a per-row
                // value, so a single UPDATE statement
                // can't cover all N. Fan out in parallel
                // instead of sequential awaits.
                await Promise.all(
                  newDocs.map((d) =>
                    db
                      .from("documents")
                      .update({
                        current_version_id: versionByDocId.get(d.id),
                      })
                      .eq("id", d.id),
                  ),
                );

                // Register every copy under a fresh doc-N
                // slug so the model can edit/read any of
                // them in the same turn.
                const existingLabels = new Set(Object.keys(docIndex));
                let nextLabelIdx = 0;
                const copies: {
                  new_filename: string;
                  document_id: string;
                  version_id: string;
                }[] = [];
                const toolPayloadCopies: {
                  doc_id: string;
                  document_id: string;
                  version_id: string;
                  filename: string;
                  download_url: string;
                }[] = [];
                for (let idx = 0; idx < newDocs.length; idx++) {
                  const d = newDocs[idx];
                  const newKey = newKeys[idx];
                  const versionId = versionByDocId.get(d.id);
                  if (!versionId) continue;
                  while (existingLabels.has(`doc-${nextLabelIdx}`))
                    nextLabelIdx++;
                  const slug = `doc-${nextLabelIdx}`;
                  existingLabels.add(slug);
                  docIndex[slug] = {
                    document_id: d.id,
                    filename: d.filename,
                  };
                  docStore.set(slug, {
                    storage_path: newKey,
                    file_type: sourceInfo.file_type,
                    filename: d.filename,
                  });
                  copies.push({
                    new_filename: d.filename,
                    document_id: d.id,
                    version_id: versionId,
                  });
                  toolPayloadCopies.push({
                    doc_id: slug,
                    document_id: d.id,
                    version_id: versionId,
                    filename: d.filename,
                    download_url: buildDownloadUrl(newKey, d.filename),
                  });
                }

                write(
                  `data: ${JSON.stringify({
                    type: "doc_replicated",
                    filename: sourceFilename,
                    count: copies.length,
                    copies,
                  })}\n\n`,
                );
                docsReplicated.push({
                  filename: sourceFilename,
                  count: copies.length,
                  copies,
                });
                toolResults.push({
                  role: "tool",
                  tool_call_id: tc.id,
                  content: JSON.stringify({
                    ok: true,
                    count: copies.length,
                    copies: toolPayloadCopies,
                  }),
                });
              }
            }
          }
        } catch (e) {
          fail(`replicate_document failed: ${String(e)}`);
        }
      }
    } else if (tc.function.name === "generate_docx") {
      const title = args.title as string;
      const landscape = !!args.landscape;
      devLog(
        `[generate_docx] title="${title}" landscape=${landscape} args.landscape=${args.landscape}`,
      );
      const previewFilename = `${
        title
          .replace(/[^a-zA-Z0-9 _-]/g, "")
          .trim()
          .slice(0, 64) || "document"
      }.docx`;
      write(
        `data: ${JSON.stringify({ type: "doc_created_start", filename: previewFilename })}\n\n`,
      );
      const result = await generateDocx(
        title,
        args.sections as unknown[],
        userId,
        db,
        { landscape, projectId: projectId ?? null },
      );
      let newDocLabel: string | null = null;
      if ("filename" in result && "download_url" in result) {
        const dlFilename = result.filename as string;
        const dlUrl = result.download_url as string;
        const documentId = (result as { document_id?: string }).document_id;
        const versionId = (result as { version_id?: string }).version_id;
        const versionNumber =
          (result as { version_number?: number }).version_number ?? null;
        const storagePath = (result as { storage_path?: string }).storage_path;

        // Register the generated doc in the chat context so
        // edit_document (and read_document / find_in_document)
        // can act on it within the same assistant turn. New label
        // is the next free `doc-N` index. Subsequent turns pick
        // it up via the normal attachment/project doc query.
        if (documentId && storagePath && docIndex) {
          const existingLabels = new Set(Object.keys(docIndex));
          let i = 0;
          while (existingLabels.has(`doc-${i}`)) i++;
          newDocLabel = `doc-${i}`;
          docIndex[newDocLabel] = {
            document_id: documentId,
            filename: dlFilename,
          };
          docStore.set(newDocLabel, {
            storage_path: storagePath,
            file_type: "docx",
            filename: dlFilename,
          });
        }

        write(
          `data: ${JSON.stringify({
            type: "doc_created",
            filename: dlFilename,
            download_url: dlUrl,
            document_id: documentId,
            version_id: versionId,
            version_number: versionNumber,
          })}\n\n`,
        );
        docsCreated.push({
          filename: dlFilename,
          download_url: dlUrl,
          document_id: documentId,
          version_id: versionId,
          version_number: versionNumber,
        });
      } else {
        write(
          `data: ${JSON.stringify({ type: "doc_created", filename: previewFilename, download_url: "" })}\n\n`,
        );
      }
      // Surface the chat-local doc label in the tool result so the
      // model can pass it as `doc_id` to edit_document / read_document
      // / find_in_document in the same turn. Without this the model
      // only sees the DB UUID, which isn't valid as a doc_id anchor.
      const { download_url, storage_path, ...safeToolResult } =
        result as Record<string, unknown>;
      const toolResultPayload = newDocLabel
        ? {
            ...safeToolResult,
            doc_id: newDocLabel,
            next_required_action: [
              `Before writing your final response, call read_document with doc_id "${newDocLabel}".`,
              `Base your description on the generated document's actual returned text, not on memory of what you intended to generate.`,
              `Do not include download links, URLs, or markdown links to the document in your prose response; the document card is shown automatically by the UI.`,
              `Give a concise description of the generated document and, if you make factual claims about its contents, cite it with [N] markers and a final <CITATIONS> block using doc_id "${newDocLabel}", not any source/template document.`,
            ].join(" "),
          }
        : safeToolResult;
      toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content: JSON.stringify(toolResultPayload),
      });
    }
  }

  if (shouldGroupFindInCase && groupedFindInCaseEvents.length > 0) {
    const errors = groupedFindInCaseEvents
      .map((event) => event.error)
      .filter((error): error is string => !!error);
    const groupEvent: CourtlistenerToolEvent = {
      type: "courtlistener_find_in_case",
      cluster_id: null,
      query: "",
      total_matches: groupedFindInCaseEvents.reduce(
        (sum, event) => sum + event.total_matches,
        0,
      ),
      searches: groupedFindInCaseEvents.map(findInCaseSearchSummary),
      ...(errors.length ? { error: errors.join("; ") } : {}),
    };
    write(`data: ${JSON.stringify(groupEvent)}\n\n`);
    courtlistenerEvents.push(groupEvent);
  }

  return {
    toolResults,
    docsRead,
    docsFound,
    docsCreated,
    docsReplicated,
    workflowsApplied,
    docsEdited,
    courtlistenerEvents,
    caseCitationEvents,
    mcpEvents,
  };
}

// ---------------------------------------------------------------------------
// Citation parsing
// ---------------------------------------------------------------------------

const CITATIONS_BLOCK_RE = /<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/;
const CITATIONS_OPEN_TAG = "<CITATIONS>";
const CITATIONS_CLOSE_TAG = "</CITATIONS>";

type CitationParseDiagnostics = {
  hasBlock: boolean;
  rawLength: number;
  error: string | null;
};

function parseCitationsWithDiagnostics(text: string): {
  citations: ParsedCitation[];
  diagnostics: CitationParseDiagnostics;
} {
  const match = text.match(CITATIONS_BLOCK_RE);
  if (!match) {
    return {
      citations: [],
      diagnostics: {
        hasBlock: false,
        rawLength: 0,
        error: null,
      },
    };
  }

  const raw = match[1] ?? "";
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return {
        citations: [],
        diagnostics: {
          hasBlock: true,
          rawLength: raw.length,
          error: "CITATIONS block JSON was not an array.",
        },
      };
    }
    return {
      citations: parsed
        .map(normalizeCitation)
        .filter((c): c is ParsedCitation => c !== null),
      diagnostics: {
        hasBlock: true,
        rawLength: raw.length,
        error: null,
      },
    };
  } catch (error) {
    return {
      citations: [],
      diagnostics: {
        hasBlock: true,
        rawLength: raw.length,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function parseCitations(text: string): ParsedCitation[] {
  return parseCitationsWithDiagnostics(text).citations;
}

function parsePartialCitationObjects(text: string): ParsedCitation[] {
  const beforeClose = text.split(CITATIONS_CLOSE_TAG)[0] ?? text;
  const arrayStart = beforeClose.indexOf("[");
  if (arrayStart < 0) return [];

  const parsed: ParsedCitation[] = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  let objectStart = -1;

  for (let i = arrayStart + 1; i < beforeClose.length; i += 1) {
    const char = beforeClose[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (char === "{") {
      if (depth === 0) objectStart = i;
      depth += 1;
    } else if (char === "}") {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        try {
          const raw = JSON.parse(beforeClose.slice(objectStart, i + 1));
          const citation = normalizeCitation(raw);
          if (citation) parsed.push(citation);
        } catch {
          /* ignore incomplete/malformed partial object */
        }
        objectStart = -1;
      }
    } else if (char === "]" && depth === 0) {
      break;
    }
  }

  return parsed;
}

function createCitationAnnotation(
  citation: ParsedCitation,
  docIndex: DocIndex,
  casesByClusterId?: CourtlistenerTurnState["casesByClusterId"],
) {
  if (citation.kind === "case") {
    const caseRecord = casesByClusterId?.get(citation.cluster_id);
    return {
      type: "citation_data",
      kind: "case",
      ref: citation.ref,
      cluster_id: citation.cluster_id,
      case_name: caseRecord?.caseName ?? null,
      citation: caseRecord?.citations[0] ?? null,
      url: caseRecord?.url ?? null,
      pdfUrl: caseRecord?.pdfUrl ?? null,
      dateFiled: caseRecord?.dateFiled ?? null,
      quotes: citation.quotes,
    };
  }

  const docInfo = resolveDoc(citation.doc_id, docIndex);
  return {
    type: "citation_data",
    kind: "document",
    ref: citation.ref,
    doc_id: citation.doc_id,
    document_id: docInfo?.document_id,
    version_id: docInfo?.version_id ?? null,
    version_number: docInfo?.version_number ?? null,
    filename: docInfo?.filename ?? citation.doc_id,
    page: citation.page,
    quote: citation.quote,
    quotes: citation.quotes,
  };
}

// ---------------------------------------------------------------------------
// LLM streaming loop
// ---------------------------------------------------------------------------

export type EditAnnotation = {
  kind: "edit";
  edit_id: string;
  document_id: string;
  version_id: string;
  version_number?: number | null;
  change_id: string;
  del_w_id?: string;
  ins_w_id?: string;
  deleted_text: string;
  inserted_text: string;
  context_before: string;
  context_after: string;
  reason?: string;
  status: "pending" | "accepted" | "rejected";
};

type AssistantEvent =
  | { type: "reasoning"; text: string }
  | { type: "doc_read"; filename: string; document_id?: string }
  | {
      type: "doc_find";
      filename: string;
      query: string;
      total_matches: number;
    }
  | {
      type: "doc_created";
      filename: string;
      download_url: string;
      document_id?: string;
      version_id?: string;
      version_number?: number | null;
    }
  | { type: "doc_download"; filename: string; download_url: string }
  | {
      type: "doc_replicated";
      /** Source document being copied. */
      filename: string;
      count: number;
      copies: {
        new_filename: string;
        document_id: string;
        version_id: string;
      }[];
    }
  | { type: "workflow_applied"; workflow_id: string; title: string }
  | {
      type: "doc_edited";
      filename: string;
      document_id: string;
      version_id: string;
      /** Per-document monotonic Vn; null if backend couldn't determine it. */
      version_number: number | null;
      download_url: string;
      annotations: EditAnnotation[];
    }
  | CaseCitationEvent
  | CourtlistenerToolEvent
  | McpToolEvent
  | { type: "case_opinions"; cluster_id: number; case: unknown }
  | { type: "content"; text: string }
  | { type: "error"; message: string };

export class AssistantStreamError extends Error {
  fullText: string;
  events: AssistantEvent[];

  constructor(message: string, fullText: string, events: AssistantEvent[]) {
    super(message);
    this.name = "AssistantStreamError";
    this.fullText = fullText;
    this.events = events;
  }
}

export class AssistantStreamAbortError extends AssistantStreamError {
  constructor(fullText: string, events: AssistantEvent[]) {
    super("Stream aborted.", fullText, events);
    this.name = "AbortError";
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as { name?: unknown; message?: unknown };
  return (
    record.name === "AbortError" || record.message === "Stream aborted."
  );
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const err = new Error("Stream aborted.");
  err.name = "AbortError";
  throw err;
}

export async function runLLMStream(params: {
  apiMessages: unknown[];
  docStore: DocStore;
  docIndex: DocIndex;
  userId: string;
  db: ReturnType<typeof createServerSupabase>;
  write: (s: string) => void;
  extraTools?: unknown[];
  includeResearchTools?: boolean;
  workflowStore?: WorkflowStore;
  tabularStore?: TabularCellStore;
  buildCitations?: (fullText: string) => unknown[];
  model?: string;
  apiKeys?: import("./llm").UserApiKeys;
  signal?: AbortSignal;
  /**
   * If set, generate_docx will attach created docs to this project so
   * they appear in the project sidebar. Leave null for general chats —
   * generated docs still get persisted, but as standalone documents.
   */
  projectId?: string | null;
}): Promise<{
  fullText: string;
  events: AssistantEvent[];
  annotations: unknown[];
}> {
  const {
    apiMessages,
    docStore,
    docIndex,
    userId,
    db,
    write,
    extraTools,
    includeResearchTools = true,
    workflowStore,
    tabularStore,
    buildCitations,
    model,
    apiKeys,
    signal,
    projectId,
  } = params;
  const researchTools = includeResearchTools ? COURTLISTENER_TOOLS : [];
  const mcpTools = await buildUserMcpTools(userId, db);
  const baseTools = [...TOOLS, ...researchTools, ...WORKFLOW_TOOLS];
  const activeTools = extraTools?.length
    ? [...baseTools, ...mcpTools, ...extraTools]
    : [...baseTools, ...mcpTools];

  // Extract system prompt; pass remaining turns to the adapter as
  // plain user/assistant messages.
  const rawMsgs = apiMessages as { role: string; content: string | null }[];
  const systemPrompt =
    rawMsgs[0]?.role === "system" ? (rawMsgs[0].content ?? "") : "";
  const chatMessages: LlmMessage[] = rawMsgs
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content ?? "",
    }));

  const events: AssistantEvent[] = [];
  // One assistant turn produces at most one document_versions row per
  // edited doc. `runToolCalls` fires once per tool-call batch; the model
  // may emit multiple batches in a single turn, so this map persists
  // across batches to let subsequent edit_document calls overwrite the
  // turn's existing version instead of creating a new one.
  const turnEditState: TurnEditState = new Map();
  const courtlistenerTurnState: CourtlistenerTurnState = {
      casesByClusterId: new Map(),
    };
  let fullText = "";
  let iterText = "";
  let iterVisibleText = "";
  let iterReasoning = "";
  let visibleTailBuffer = "";
  let citationsOpenSeen = false;
  let streamingCitationsBuffer = "";
  let streamedCitationCount = 0;

  const emitCitationStreamSnapshot = (
    status: "started" | "partial",
    citations: unknown[],
  ) => {
    if (buildCitations) return;
    write(`data: ${JSON.stringify({ type: "citations", status, citations })}\n\n`);
  };

  const streamHiddenCitationContent = (delta: string) => {
    if (buildCitations || !delta) return;
    streamingCitationsBuffer += delta;
    const partial = parsePartialCitationObjects(streamingCitationsBuffer);
    if (partial.length <= streamedCitationCount) return;
    streamedCitationCount = partial.length;
    const citations = partial.map((c) =>
      createCitationAnnotation(
        c,
        docIndex,
        courtlistenerTurnState.casesByClusterId,
      ),
    );
    emitCitationStreamSnapshot("partial", citations);
  };

  const streamVisibleContent = (delta: string) => {
    if (!delta) return;
    if (citationsOpenSeen) {
      streamHiddenCitationContent(delta);
      return;
    }

    const combined = visibleTailBuffer + delta;
    const markerIdx = combined.indexOf(CITATIONS_OPEN_TAG);
    if (markerIdx >= 0) {
      const visible = combined.slice(0, markerIdx);
      if (visible) {
        iterVisibleText += visible;
        write(
          `data: ${JSON.stringify({ type: "content_delta", text: visible })}\n\n`,
        );
      }
      visibleTailBuffer = "";
      citationsOpenSeen = true;
      streamingCitationsBuffer = "";
      streamedCitationCount = 0;
      emitCitationStreamSnapshot("started", []);
      streamHiddenCitationContent(
        combined.slice(markerIdx + CITATIONS_OPEN_TAG.length),
      );
      return;
    }

    const keep = Math.min(CITATIONS_OPEN_TAG.length - 1, combined.length);
    const visible = combined.slice(0, combined.length - keep);
    visibleTailBuffer = combined.slice(combined.length - keep);
    if (visible) {
      iterVisibleText += visible;
      write(
        `data: ${JSON.stringify({ type: "content_delta", text: visible })}\n\n`,
      );
    }
  };

  const flushVisibleTail = (opts: { emit?: boolean } = {}) => {
    const emit = opts.emit ?? true;
    if (citationsOpenSeen || !visibleTailBuffer) {
      visibleTailBuffer = "";
      return;
    }
    iterVisibleText += visibleTailBuffer;
    if (emit) {
      write(
        `data: ${JSON.stringify({ type: "content_delta", text: visibleTailBuffer })}\n\n`,
      );
    }
    visibleTailBuffer = "";
  };

  const flushText = (opts: { emit?: boolean } = {}) => {
    if (!iterText) return;
    fullText += iterText;
    flushVisibleTail(opts);
    if (iterVisibleText) {
      events.push({ type: "content", text: iterVisibleText });
    }
    iterText = "";
    iterVisibleText = "";
    visibleTailBuffer = "";
    citationsOpenSeen = false;
    streamingCitationsBuffer = "";
    streamedCitationCount = 0;
  };

  const flushPartialTurn = (opts: { emit?: boolean } = {}) => {
    flushText(opts);
    if (iterReasoning) {
      events.push({ type: "reasoning", text: iterReasoning });
      iterReasoning = "";
    }
  };

  const selectedModel = resolveModel(model, DEFAULT_MAIN_MODEL);

  try {
    throwIfAborted(signal);
    await streamChatWithTools({
      model: selectedModel,
      systemPrompt,
      messages: chatMessages,
      tools: activeTools as OpenAIToolSchema[],
      maxIterations: 10,
      apiKeys,
      enableThinking: true,
      abortSignal: signal,
      callbacks: {
        onContentDelta: (delta) => {
          iterText += delta;
          streamVisibleContent(delta);
        },
        onReasoningDelta: (delta) => {
          iterReasoning += delta;
          write(
            `data: ${JSON.stringify({ type: "reasoning_delta", text: delta })}\n\n`,
          );
        },
        onReasoningBlockEnd: () => {
          if (!iterReasoning) return;
          events.push({ type: "reasoning", text: iterReasoning });
          write(`data: ${JSON.stringify({ type: "reasoning_block_end" })}\n\n`);
          iterReasoning = "";
        },
        // Fires after Claude's turn ends with stop_reason=tool_use, before
        // the tool actually runs. Flushes any buffered assistant text so
        // it's emitted in chronological order, then signals the client so
        // it can open a fresh PreResponseWrapper (shows "Working…") while
        // the tool executes — avoids the dead gap between message_stop
        // and the first tool-specific event.
        onToolCallStart: (call) => {
          flushText();
          write(
            `data: ${JSON.stringify({
              type: "tool_call_start",
              name: call.name,
            })}\n\n`,
          );
        },
      },
      runTools: async (calls) => {
        throwIfAborted(signal);
        // Emit any text the model produced before this tool turn so the
        // UI sees it before the tool results stream in.
        flushText();

        const toolCalls: ToolCall[] = calls.map((c) => ({
          id: c.id,
          function: {
            name: c.name,
            arguments: JSON.stringify(c.input),
          },
        }));
        const {
          toolResults,
          docsRead,
          docsFound,
          docsCreated,
          docsReplicated,
          workflowsApplied,
          docsEdited,
          courtlistenerEvents,
          caseCitationEvents,
          mcpEvents,
        } = await runToolCalls(
          toolCalls,
          docStore,
          userId,
          db,
          write,
          workflowStore,
          tabularStore,
          docIndex,
          turnEditState,
          projectId,
        courtlistenerTurnState,
        apiKeys,
      );
        throwIfAborted(signal);
        for (const r of docsRead) {
          events.push({
            type: "doc_read",
            filename: r.filename,
            document_id: r.document_id,
          });
        }
        for (const f of docsFound) {
          events.push({
            type: "doc_find",
            filename: f.filename,
            query: f.query,
            total_matches: f.total_matches,
          });
        }
        for (const dl of docsCreated) {
          events.push({
            type: "doc_created",
            filename: dl.filename,
            download_url: dl.download_url,
            document_id: dl.document_id,
            version_id: dl.version_id,
            version_number: dl.version_number ?? null,
          });
        }
        for (const r of docsReplicated) {
          events.push({
            type: "doc_replicated",
            filename: r.filename,
            count: r.count,
            copies: r.copies,
          });
        }
        for (const wf of workflowsApplied) {
          events.push({
            type: "workflow_applied",
            workflow_id: wf.workflow_id,
            title: wf.title,
          });
        }
        for (const e of docsEdited) {
          events.push({
            type: "doc_edited",
            filename: e.filename,
            document_id: e.document_id,
            version_id: e.version_id,
            version_number: e.version_number,
            download_url: e.download_url,
            annotations: e.annotations,
          });
        }
        for (const event of courtlistenerEvents) {
          events.push(event);
        }
        for (const event of mcpEvents) {
          events.push(event);
        }
        for (const event of caseCitationEvents) {
          events.push(event);
        }

        // Index alignment would break if any tool branch skips its
        // push (unhandled tool name, disabled store, guard failure).
        // Each tool_result already carries its tool_call_id, so key off
        // that directly — and fall back to an error result for any
        // tool_use that didn't produce one, so Claude's next request
        // has a tool_result for every tool_use it sent.
        const resultByCallId = new Map<string, string>();
        for (const r of toolResults) {
          const row = r as { tool_call_id: string; content?: unknown };
          resultByCallId.set(row.tool_call_id, String(row.content ?? ""));
        }
        return toolCalls.map((c) => ({
          tool_use_id: c.id,
          content:
            resultByCallId.get(c.id) ??
            JSON.stringify({
              error: `Tool '${c.function.name}' is not available.`,
            }),
        }));
      },
    });
  } catch (err) {
    if (isAbortError(err)) {
      flushPartialTurn({ emit: false });
      throw new AssistantStreamAbortError(fullText, events);
    }
    flushPartialTurn();
    const message = safeErrorMessage(err, "Stream error");
    events.push({ type: "error", message });
    throw new AssistantStreamError(message, fullText, events);
  }

  flushText();

  // Parse and emit citations from <CITATIONS> block
  const { citations: parsedCitations, diagnostics: citationDiagnostics } =
    parseCitationsWithDiagnostics(fullText);
  const citations = buildCitations
    ? buildCitations(fullText)
    : parsedCitations.map((c) =>
        createCitationAnnotation(
          c,
          docIndex,
          courtlistenerTurnState.casesByClusterId,
        ),
      );
  devLog("[chat/stream] final citation annotations", {
    hasCitationsBlock: citationDiagnostics.hasBlock,
    citationsBlockLength: citationDiagnostics.rawLength,
    parseError: citationDiagnostics.error,
    parsedCitationCount: parsedCitations.length,
    emittedAnnotationCount: citations.length,
    usedCustomCitationBuilder: !!buildCitations,
  });
  write(
    `data: ${JSON.stringify({ type: "citations", status: "final", citations })}\n\n`,
  );
  write("data: [DONE]\n\n");

  return { fullText, events, annotations: citations };
}

// ---------------------------------------------------------------------------
// Annotation extraction (for DB save)
// ---------------------------------------------------------------------------

export function extractAnnotations(
  fullText: string,
  docIndex: DocIndex,
  _events?: ({ type: string } & Record<string, unknown>[]) | unknown[],
): unknown[] {
  return parseCitations(fullText).map((c) =>
    createCitationAnnotation(c, docIndex),
  );
}

export function stripTransientAssistantEvents(events: AssistantEvent[]) {
  return events.filter((event) => event.type !== "case_opinions");
}

export function appendCancelledAssistantEvent(events: AssistantEvent[]) {
  return [...events, { type: "content" as const, text: "Cancelled by user." }];
}

export function buildCancelledAssistantMessage(args: {
  fullText: string;
  events: AssistantEvent[];
  buildAnnotations: (fullText: string, events: AssistantEvent[]) => unknown[];
}) {
  const events = appendCancelledAssistantEvent(
    stripTransientAssistantEvents(args.events),
  );
  return {
    events,
    annotations: args.buildAnnotations(args.fullText, events),
  };
}

// ---------------------------------------------------------------------------
// Document context builder (from message file attachments)
// ---------------------------------------------------------------------------

export async function buildDocContext(
  messages: ChatMessage[],
  userId: string,
  db: ReturnType<typeof createServerSupabase>,
  chatId?: string | null,
): Promise<{ docIndex: DocIndex; docStore: DocStore }> {
  const docIndex: DocIndex = {};
  const docStore: DocStore = new Map();

  const documentIds = new Set<string>();
  for (const m of messages) {
    for (const f of m.files ?? []) {
      if (f.document_id) documentIds.add(f.document_id);
    }
  }

  // Also pull in document_ids from prior assistant events in this chat —
  // generated docs (generate_docx) and tracked-change edits (edit_document)
  // aren't attached to user messages as files, so they only live in the
  // assistant's `doc_created` / `doc_edited` events. Without this sweep
  // the model loses access to generated docs after the turn that created
  // them, and can't call edit_document / read_document on them.
  if (chatId) {
    const { data: rows } = await db
      .from("chat_messages")
      .select("content")
      .eq("chat_id", chatId)
      .eq("role", "assistant");
    for (const row of rows ?? []) {
      const content = (row as { content?: unknown }).content;
      if (!Array.isArray(content)) continue;
      for (const ev of content as Record<string, unknown>[]) {
        if (
          (ev?.type === "doc_created" || ev?.type === "doc_edited") &&
          typeof ev.document_id === "string"
        ) {
          documentIds.add(ev.document_id);
        }
      }
    }
  }

  const ids = [...documentIds];
  if (ids.length > 0) {
    const { data: docs } = await db
      .from("documents")
      .select("id, current_version_id, status")
      .in("id", ids)
      .eq("user_id", userId)
      .eq("status", "ready");

    const docList = (docs ?? []) as unknown as {
      id: string;
      filename?: string | null;
      file_type?: string | null;
      current_version_id?: string | null;
      active_version_number?: number | null;
      storage_path?: string | null;
    }[];
    await attachActiveVersionPaths(db, docList);
    for (let i = 0; i < docList.length; i++) {
      const doc = docList[i];
      if (!doc.storage_path) continue;
      const docLabel = `doc-${i}`;
      const filename = doc.filename?.trim() || "Untitled document";
      docIndex[docLabel] = {
        document_id: doc.id,
        filename,
        version_id: doc.current_version_id ?? null,
        version_number: doc.active_version_number ?? null,
      };
      docStore.set(docLabel, {
        storage_path: doc.storage_path,
        file_type: doc.file_type ?? "",
        filename,
      });
    }
  }

  devLog(
    "[buildDocContext] available docs:",
    Object.entries(docIndex).map(([label, info]) => ({
      label,
      filename: info.filename,
      document_id: info.document_id,
    })),
  );
  return { docIndex, docStore };
}

export async function buildProjectDocContext(
  projectId: string,
  _userId: string,
  db: ReturnType<typeof createServerSupabase>,
): Promise<{
  docIndex: DocIndex;
  docStore: DocStore;
  folderPaths: Map<string, string>;
}> {
  const docIndex: DocIndex = {};
  const docStore: DocStore = new Map();

  const [{ data: docs }, { data: folders }] = await Promise.all([
    db
      .from("documents")
      .select("id, current_version_id, status, folder_id")
      .eq("project_id", projectId)
      .eq("status", "ready")
      .order("created_at", { ascending: true }),
    db
      .from("project_subfolders")
      .select("id, name, parent_folder_id")
      .eq("project_id", projectId),
  ]);
  const docList = (docs ?? []) as unknown as {
    id: string;
    filename?: string | null;
    file_type?: string | null;
    current_version_id?: string | null;
    active_version_number?: number | null;
    folder_id?: string | null;
    storage_path?: string | null;
  }[];
  await attachActiveVersionPaths(db, docList);

  // Build folder id → full path map
  const folderMap = new Map<
    string,
    { name: string; parent_folder_id: string | null }
  >();
  for (const f of folders ?? [])
    folderMap.set(f.id, {
      name: f.name,
      parent_folder_id: f.parent_folder_id,
    });

  function resolvePath(folderId: string | null): string {
    if (!folderId) return "";
    const parts: string[] = [];
    let cur: string | null = folderId;
    while (cur) {
      const f = folderMap.get(cur);
      if (!f) break;
      parts.unshift(f.name);
      cur = f.parent_folder_id;
    }
    return parts.join(" / ");
  }

  const folderPaths = new Map<string, string>(); // doc label → folder path

  for (let i = 0; i < docList.length; i++) {
    const doc = docList[i];
    if (!doc.storage_path) continue;
    const docLabel = `doc-${i}`;
    const filename = doc.filename?.trim() || "Untitled document";
    docIndex[docLabel] = {
      document_id: doc.id,
      filename,
      version_id: doc.current_version_id ?? null,
      version_number: doc.active_version_number ?? null,
    };
    docStore.set(docLabel, {
      storage_path: doc.storage_path,
      file_type: doc.file_type ?? "",
      filename,
    });
    const path = resolvePath(doc.folder_id ?? null);
    if (path) folderPaths.set(docLabel, path);
  }

  devLog(
    "[buildProjectDocContext] available docs:",
    Object.entries(docIndex).map(([label, info]) => ({
      label,
      filename: info.filename,
      document_id: info.document_id,
      folder: folderPaths.get(label) ?? null,
    })),
  );
  return { docIndex, docStore, folderPaths };
}

export async function buildWorkflowStore(
  userId: string,
  userEmail: string | null | undefined,
  db: ReturnType<typeof createServerSupabase>,
): Promise<WorkflowStore> {
  const { BUILTIN_WORKFLOWS } = await import("./builtinWorkflows");
  const store: WorkflowStore = new Map();
  const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();

  // Seed built-ins first
  for (const wf of BUILTIN_WORKFLOWS) {
    store.set(wf.id, { title: wf.title, prompt_md: wf.prompt_md });
  }

  // Then overlay user-owned assistant workflows.
  const { data: workflows } = await db
    .from("workflows")
    .select("id, title, prompt_md")
    .eq("user_id", userId)
    .eq("type", "assistant");
  for (const wf of workflows ?? []) {
    if (wf.prompt_md) {
      store.set(wf.id, { title: wf.title, prompt_md: wf.prompt_md });
    }
  }

  // Shared assistant workflows must also be readable by workflow tools.
  if (normalizedUserEmail) {
    const { data: shares } = await db
      .from("workflow_shares")
      .select("workflow_id")
      .eq("shared_with_email", normalizedUserEmail);
    const sharedIds = [
      ...new Set((shares ?? []).map((share) => share.workflow_id)),
    ];
    if (sharedIds.length > 0) {
      const { data: sharedWorkflows } = await db
        .from("workflows")
        .select("id, title, prompt_md")
        .in("id", sharedIds)
        .eq("type", "assistant");
      for (const wf of sharedWorkflows ?? []) {
        if (wf.prompt_md) {
          store.set(wf.id, {
            title: wf.title,
            prompt_md: wf.prompt_md,
          });
        }
      }
    }
  }
  return store;
}
