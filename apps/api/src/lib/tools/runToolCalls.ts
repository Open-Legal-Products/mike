import { createServerSupabase } from "../supabase";
import {
  COURTLISTENER_TOOL_NAMES,
  type CaseCitationEvent,
  type CourtlistenerToolEvent,
} from "../legalSourcesTools/courtlistenerTools";
import { executeMcpToolCall, type McpToolEvent } from "../mcpConnectors";
import { logger } from "../logger";
import type {
  DocStore,
  DocIndex,
  WorkflowStore,
  TabularCellStore,
  ToolCall,
} from "../chatToolDefs";
import { throwIfAborted } from "./abort";
import { parseFindInCaseArgs, findInCaseSearchSummary } from "./caseLaw";
import {
  getToolHandler,
  type ToolExecutionContext,
  type ToolRunResults,
  type FindInCaseGroupState,
} from "./registry";
import type {
  TurnEditState,
  DocCreatedResult,
  DocReplicatedResult,
  DocEditedResult,
  CourtlistenerTurnState,
} from "./types";

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
  apiKeys?: import("../llm").UserApiKeys,
  nonce?: string,
  signal?: AbortSignal,
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
  const results: ToolRunResults = {
    toolResults: [],
    docsRead: [],
    docsFound: [],
    docsCreated: [],
    docsReplicated: [],
    workflowsApplied: [],
    docsEdited: [],
    courtlistenerEvents: [],
    caseCitationEvents: [],
    mcpEvents: [],
  };
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
      } catch (err) {
        logger.debug(
          { err, tool: tc.function.name },
          "[runToolCalls] malformed find_in_case tool arguments; using empty args",
        );
      }
      const parsed = parseFindInCaseArgs(rawArgs);
      return {
        cluster_id: parsed.clusterId,
        query: parsed.query,
        total_matches: 0,
      };
    });
  const findInCaseGroup: FindInCaseGroupState = {
    enabled: groupedFindInCaseSearches.length > 1,
    started: false,
    searches: groupedFindInCaseSearches,
    events: [],
  };

  for (const tc of toolCalls) {
    throwIfAborted(signal);
    let args: Record<string, unknown> = {};
    try {
      args = JSON.parse(tc.function.arguments || "{}");
    } catch (err) {
      logger.debug(
        { err, tool: tc.function.name },
        "[runToolCalls] malformed tool arguments; using empty args",
      );
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
      results.toolResults.push({
        role: "tool",
        tool_call_id: tc.id,
        content,
      });
      results.mcpEvents.push(event);
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

    const handler = getToolHandler(tc.function.name);
    if (!handler) continue;
    const ctx: ToolExecutionContext = {
      toolCallId: tc.id,
      docStore,
      userId,
      db,
      write,
      workflowStore,
      tabularStore,
      docIndex,
      turnEditState,
      projectId,
      courtState,
      apiKeys,
      nonce,
      results,
      findInCaseGroup,
    };
    await handler(args, ctx);
  }

  if (findInCaseGroup.enabled && findInCaseGroup.events.length > 0) {
    const errors = findInCaseGroup.events
      .map((event) => event.error)
      .filter((error): error is string => !!error);
    const groupEvent: CourtlistenerToolEvent = {
      type: "courtlistener_find_in_case",
      cluster_id: null,
      query: "",
      total_matches: findInCaseGroup.events.reduce(
        (sum, event) => sum + event.total_matches,
        0,
      ),
      searches: findInCaseGroup.events.map(findInCaseSearchSummary),
      ...(errors.length ? { error: errors.join("; ") } : {}),
    };
    write(`data: ${JSON.stringify(groupEvent)}\n\n`);
    results.courtlistenerEvents.push(groupEvent);
  }

  return results;
}
