import { randomUUID } from "crypto";
import path from "path";
import type { LlmIterationLog, NormalizedToolCall } from "./llm/types";
import { Logger, createAgentRunLogDir } from "./logger";

export type AgentLogStatus = "success" | "error";

export type AgentLogSource = "api" | "estimated";

/** JSONL schema aligned with harness-style agent run logs. */
export type AgentLogRecord = {
  step: string;
  action: string;
  tool?: string;
  filepath?: string;
  status: AgentLogStatus;
  notes?: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  source: AgentLogSource;
};

export function isAgentStepLoggingEnabled(): boolean {
  return process.env.AGENT_STEP_LOGGING !== "false";
}

function estimateTokens(value: unknown): number {
  if (value == null) return 0;
  const text =
    typeof value === "string" ? value : JSON.stringify(value) ?? "";
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function tokenFields(args: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  source: AgentLogSource;
}): Pick<
  AgentLogRecord,
  "input_tokens" | "output_tokens" | "total_tokens" | "source"
> {
  const input_tokens = Math.max(0, args.inputTokens ?? 0);
  const output_tokens = Math.max(0, args.outputTokens ?? 0);
  return {
    input_tokens,
    output_tokens,
    total_tokens: input_tokens + output_tokens,
    source: args.source,
  };
}

function truncateNotes(notes: string, max = 4000): string {
  const trimmed = notes.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function summarizeText(text: string, label: string): string {
  const trimmed = text.trim();
  if (!trimmed) return `${label}: empty.`;
  return `${label}: ${trimmed.length} chars.`;
}

/**
 * Structured agent-step logger. Each step is one JSONL record via Logger.
 */
export class AgentStepLogger {
  private readonly logger: Logger;
  private readonly sessionId: string;
  private readonly runLogDir: string;
  private readonly runId: string;
  private readonly model: string | null;

  constructor(args: { userId?: string; model?: string }) {
    this.sessionId = randomUUID();
    this.model = args.model ?? null;
    this.runLogDir = createAgentRunLogDir();
    this.runId = path.basename(this.runLogDir);
    this.logger = new Logger(`agent-${this.sessionId}.jsonl`, this.runLogDir);
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getRunLogDir(): string {
    return this.runLogDir;
  }

  getRunId(): string {
    return this.runId;
  }

  getLogFilename(): string {
    return `agent-${this.sessionId}.jsonl`;
  }

  private write(record: AgentLogRecord): void {
    if (!isAgentStepLoggingEnabled()) return;
    const entry: AgentLogRecord = { ...record };
    if (entry.notes) entry.notes = truncateNotes(entry.notes);
    if (!entry.tool) delete entry.tool;
    if (!entry.filepath) delete entry.filepath;
    if (!entry.notes) delete entry.notes;
    this.logger.log(entry as unknown as Record<string, unknown>, {
      omitTimestamp: true,
    });
  }

  logTurnStart(inputs: { systemPrompt: string; messages: unknown }): void {
    const messageCount = Array.isArray(inputs.messages)
      ? inputs.messages.length
      : 0;
    const inputTokens = estimateTokens(inputs);
    this.write({
      step: "turn_start",
      action: "Loaded conversation context and system prompt",
      status: "success",
      notes: `${messageCount} chat message(s); system prompt ${inputs.systemPrompt.length} chars.`,
      ...tokenFields({
        inputTokens,
        outputTokens: 0,
        source: "estimated",
      }),
    });
  }

  logLlmIteration(info: LlmIterationLog): void {
    const toolNames = info.artifacts.toolCalls.map((call) => call.name);
    const hasApiUsage =
      info.inputTokens != null && info.outputTokens != null;
    const notes = [
      summarizeText(info.artifacts.text, "Model text"),
      toolNames.length
        ? `Tool calls: ${toolNames.join(", ")}.`
        : "No tool calls in this iteration.",
      this.model ? `Model: ${this.model}.` : null,
    ]
      .filter(Boolean)
      .join(" ");

    this.write({
      step: `llm_iteration_${info.iteration}`,
      action: `Completed model iteration ${info.iteration}`,
      status: "success",
      notes,
      ...tokenFields({
        inputTokens: hasApiUsage
          ? info.inputTokens
          : estimateTokens(info.inputs),
        outputTokens: hasApiUsage
          ? info.outputTokens
          : estimateTokens(info.artifacts.text) +
            estimateTokens(info.artifacts.toolCalls),
        source: hasApiUsage ? "api" : "estimated",
      }),
    });
  }

  logThinking(text: string, iteration: number | null): void {
    this.write({
      step: iteration == null ? "thinking" : `thinking_${iteration}`,
      action: "Recorded model reasoning block",
      status: "success",
      notes: summarizeText(text, "Reasoning"),
      ...tokenFields({
        inputTokens: 0,
        outputTokens: estimateTokens(text),
        source: "estimated",
      }),
    });
  }

  logContent(text: string, iteration: number | null): void {
    this.write({
      step: iteration == null ? "response_content" : `response_content_${iteration}`,
      action: "Recorded assistant response text segment",
      status: "success",
      notes: summarizeText(text, "Response"),
      ...tokenFields({
        inputTokens: 0,
        outputTokens: estimateTokens(text),
        source: "estimated",
      }),
    });
  }

  logToolExecution(args: {
    tool: string;
    action: string;
    filepath?: string;
    status?: AgentLogStatus;
    notes?: string;
    inputText?: string;
    outputText?: string;
  }): void {
    this.write({
      step: args.tool,
      action: args.action,
      tool: args.tool,
      filepath: args.filepath,
      status: args.status ?? "success",
      notes: args.notes,
      ...tokenFields({
        inputTokens: estimateTokens(args.inputText ?? ""),
        outputTokens: estimateTokens(args.outputText ?? ""),
        source: "estimated",
      }),
    });
  }

  logCitations(citations: unknown[]): void {
    this.write({
      step: "citations",
      action: "Parsed and emitted citation annotations",
      status: "success",
      notes: `${citations.length} citation(s) emitted.`,
      ...tokenFields({
        inputTokens: 0,
        outputTokens: estimateTokens(citations),
        source: "estimated",
      }),
    });
  }

  logTurnComplete(args: {
    fullText: string;
    events: unknown[];
    annotations: unknown[];
  }): void {
    this.write({
      step: "turn_complete",
      action: "Completed assistant turn",
      status: "success",
      notes: [
        summarizeText(args.fullText, "Final response"),
        `${args.events.length} event(s), ${args.annotations.length} annotation(s).`,
      ].join(" "),
      ...tokenFields({
        inputTokens: estimateTokens(args.events),
        outputTokens: estimateTokens(args.fullText),
        source: "estimated",
      }),
    });
  }

  logError(message: string, context?: unknown): void {
    this.write({
      step: "error",
      action: "Agent turn failed",
      status: "error",
      notes: context
        ? `${message} Context: ${truncateNotes(JSON.stringify(context), 2000)}`
        : message,
      ...tokenFields({
        inputTokens: estimateTokens(context),
        outputTokens: estimateTokens(message),
        source: "estimated",
      }),
    });
  }

  async flush(): Promise<void> {
    await this.logger.flush();
  }
}

export function buildToolExecutionLogs(args: {
  calls: NormalizedToolCall[];
  toolResults: { tool_call_id: string; content?: unknown }[];
  docStoragePath?: (docLabel: string) => string | undefined;
}): Array<{
  tool: string;
  action: string;
  filepath?: string;
  notes: string;
  inputText: string;
  outputText: string;
  status: AgentLogStatus;
}> {
  const resultById = new Map(
    args.toolResults.map((row) => [row.tool_call_id, row.content]),
  );

  return args.calls.map((call) => {
    const inputText = JSON.stringify(call.input ?? {});
    const rawResult = resultById.get(call.id);
    const outputText =
      typeof rawResult === "string"
        ? rawResult
        : rawResult == null
          ? ""
          : JSON.stringify(rawResult);

    const action = buildToolAction(call.name, call.input);
    const filepath = resolveToolFilepath(call, args.docStoragePath);
    const notes = buildToolNotes(call.name, call.input, outputText);
    const status: AgentLogStatus =
      /"error"|^error:|failed/i.test(outputText.slice(0, 200))
        ? "error"
        : "success";

    return {
      tool: call.name,
      action,
      filepath,
      notes,
      inputText,
      outputText,
      status,
    };
  });
}

function buildToolAction(tool: string, input: Record<string, unknown>): string {
  switch (tool) {
    case "read_document":
      return `Read document ${String(input.doc_id ?? "unknown")}`;
    case "find_in_document":
      return `Searched document ${String(input.doc_id ?? "unknown")} for "${String(input.query ?? "")}"`;
    case "list_documents":
      return "Listed available documents";
    case "fetch_documents":
      return `Fetched ${Array.isArray(input.doc_ids) ? input.doc_ids.length : 0} document(s)`;
    case "generate_docx":
      return `Generated document "${String(input.title ?? "untitled")}"`;
    case "edit_document":
      return `Edited document ${String(input.doc_id ?? "unknown")}`;
    case "replicate_document":
      return `Replicated document ${String(input.doc_id ?? "unknown")}`;
    case "apply_workflow":
      return `Applied workflow ${String(input.workflow_id ?? "unknown")}`;
    default:
      if (tool.startsWith("mcp_")) {
        return `Executed MCP tool ${tool}`;
      }
      if (tool.startsWith("courtlistener_")) {
        return `Executed CourtListener tool ${tool}`;
      }
      return `Executed ${tool}`;
  }
}

function resolveToolFilepath(
  call: NormalizedToolCall,
  docStoragePath?: (docLabel: string) => string | undefined,
): string | undefined {
  const docId = call.input.doc_id;
  if (
    (call.name === "read_document" || call.name === "find_in_document") &&
    typeof docId === "string" &&
    docStoragePath
  ) {
    return docStoragePath(docId);
  }
  if (call.name === "generate_docx" && typeof call.input.title === "string") {
    return call.input.title;
  }
  return undefined;
}

function buildToolNotes(
  tool: string,
  input: Record<string, unknown>,
  outputText: string,
): string {
  const parts = [summarizeText(outputText, "Tool output")];

  if (tool === "find_in_document") {
    try {
      const parsed = JSON.parse(outputText) as { total_matches?: number };
      if (typeof parsed.total_matches === "number") {
        parts.push(`${parsed.total_matches} match(es).`);
      }
    } catch {
      /* ignore */
    }
  }

  if (tool === "generate_docx" && typeof input.title === "string") {
    parts.push(`Title: ${input.title}.`);
  }

  if (tool.startsWith("mcp_")) {
    parts.push(`MCP tool ${tool}.`);
  }

  return parts.join(" ");
}
