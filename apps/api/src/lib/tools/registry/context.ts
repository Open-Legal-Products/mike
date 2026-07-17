import { createServerSupabase } from "../../supabase";
import type { UserApiKeys } from "../../llm";
import type {
  CaseCitationEvent,
  CourtlistenerToolEvent,
} from "../../legalSourcesTools/courtlistenerTools";
import type { McpToolEvent } from "../../mcpConnectors";
import type {
  DocStore,
  DocIndex,
  WorkflowStore,
  TabularCellStore,
} from "../../chatToolDefs";
import type {
  TurnEditState,
  DocCreatedResult,
  DocReplicatedResult,
  DocEditedResult,
  CourtlistenerTurnState,
} from "../types";

export type ToolRunResults = {
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
};

// Per-batch state for collapsing multiple find_in_case calls into one grouped
// start event + one grouped result event (matches the pre-registry behavior).
export type FindInCaseGroupState = {
  enabled: boolean;
  started: boolean;
  searches: { cluster_id: number | null; query: string; total_matches: number }[];
  events: Extract<
    CourtlistenerToolEvent,
    { type: "courtlistener_find_in_case" }
  >[];
};

export type ToolExecutionContext = {
  toolCallId: string;
  docStore: DocStore;
  userId: string;
  db: ReturnType<typeof createServerSupabase>;
  write: (s: string) => void;
  workflowStore?: WorkflowStore;
  tabularStore?: TabularCellStore;
  docIndex?: DocIndex;
  turnEditState?: TurnEditState;
  projectId?: string | null;
  courtState: CourtlistenerTurnState;
  apiKeys?: UserApiKeys;
  nonce?: string;
  results: ToolRunResults;
  findInCaseGroup: FindInCaseGroupState;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolExecutionContext,
) => Promise<void>;

export function pushToolResult(ctx: ToolExecutionContext, content: string): void {
  ctx.results.toolResults.push({
    role: "tool",
    tool_call_id: ctx.toolCallId,
    content,
  });
}

// Wraps untrusted user-controlled text in a nonce-fenced tag.
// The LLM treats everything inside <untrusted-content> tags as data only.
export function spotlight(text: string, nonce: string): string {
    return `<untrusted-content nonce="${nonce}">\n${text}\n</untrusted-content>`;
}

export function citationReminder(docLabel: string, filename: string): string {
  return [
    `[Citation requirement for ${docLabel} ("${filename}")]:`,
    `If your final answer makes any factual claim from this document, include inline [N] markers and append a final <CITATIONS> JSON block.`,
    `Every citation entry for this document MUST use "doc_id": "${docLabel}".`,
    `Use this citation object shape: {"ref": 1, "doc_id": "${docLabel}", "quotes": [{"page": 1, "quote": "exact verbatim text from the document"}]}. Include top-level "page" and "quote" too only if they match the first quote.`,
    `Do not use "marker" or "text" keys in the citation block; use "ref" and "quotes".`,
  ].join("\n");
}
