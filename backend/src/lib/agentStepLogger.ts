import { randomUUID } from "crypto";
import path from "path";
import type { LlmIterationLog, NormalizedToolCall } from "./llm/types";
import { Logger, createAgentRunLogDir } from "./logger";

export type AgentStepType =
  | "turn_start"
  | "llm_iteration"
  | "thinking"
  | "content"
  | "tool_calling"
  | "tool_result"
  | "citations"
  | "turn_complete"
  | "error";

export function isAgentStepLoggingEnabled(): boolean {
  return process.env.AGENT_STEP_LOGGING !== "false";
}

/**
 * Structured agent-step logger. Each step is written as one JSON line via Logger.
 */
export class AgentStepLogger {
  private readonly logger: Logger;
  private readonly sessionId: string;
  private readonly runLogDir: string;
  private readonly runId: string;
  private readonly userId: string | null;
  private readonly model: string | null;
  private step = 0;

  constructor(args: { userId?: string; model?: string }) {
    this.sessionId = randomUUID();
    this.userId = args.userId ?? null;
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

  private emit(args: {
    stepType: AgentStepType;
    iteration?: number | null;
    inputs: unknown;
    inputTokens: number | null;
    outputTokens: number | null;
    artifacts: unknown;
  }): void {
    if (!isAgentStepLoggingEnabled()) return;
    this.step += 1;
    this.logger.log({
      sessionId: this.sessionId,
      runId: this.runId,
      step: this.step,
      stepType: args.stepType,
      iteration: args.iteration ?? null,
      model: this.model,
      userId: this.userId,
      inputs: args.inputs,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      artifacts: args.artifacts,
    });
  }

  logTurnStart(inputs: { systemPrompt: string; messages: unknown }): void {
    this.emit({
      stepType: "turn_start",
      inputs,
      inputTokens: null,
      outputTokens: null,
      artifacts: null,
    });
  }

  logLlmIteration(info: LlmIterationLog): void {
    this.emit({
      stepType: "llm_iteration",
      iteration: info.iteration,
      inputs: info.inputs,
      inputTokens: info.inputTokens,
      outputTokens: info.outputTokens,
      artifacts: info.artifacts,
    });
  }

  logThinking(
    inputs: unknown,
    text: string,
    iteration: number | null,
  ): void {
    this.emit({
      stepType: "thinking",
      iteration,
      inputs,
      inputTokens: null,
      outputTokens: null,
      artifacts: { text },
    });
  }

  logContent(
    inputs: unknown,
    text: string,
    iteration: number | null,
  ): void {
    this.emit({
      stepType: "content",
      iteration,
      inputs,
      inputTokens: null,
      outputTokens: null,
      artifacts: { text },
    });
  }

  logToolCalling(calls: NormalizedToolCall[], iteration: number | null): void {
    this.emit({
      stepType: "tool_calling",
      iteration,
      inputs: {
        tools: calls.map((call) => ({
          id: call.id,
          name: call.name,
          arguments: call.input,
        })),
      },
      inputTokens: null,
      outputTokens: null,
      artifacts: null,
    });
  }

  logToolResult(args: {
    iteration: number | null;
    toolResults: unknown[];
    events: unknown[];
  }): void {
    this.emit({
      stepType: "tool_result",
      iteration: args.iteration,
      inputs: null,
      inputTokens: null,
      outputTokens: null,
      artifacts: {
        toolResults: args.toolResults,
        events: args.events,
      },
    });
  }

  logCitations(inputs: unknown, citations: unknown[]): void {
    this.emit({
      stepType: "citations",
      inputs,
      inputTokens: null,
      outputTokens: null,
      artifacts: { citations },
    });
  }

  logTurnComplete(artifacts: {
    fullText: string;
    events: unknown[];
    annotations: unknown[];
  }): void {
    this.emit({
      stepType: "turn_complete",
      inputs: null,
      inputTokens: null,
      outputTokens: null,
      artifacts,
    });
  }

  logError(inputs: unknown, message: string, artifacts?: unknown): void {
    this.emit({
      stepType: "error",
      inputs,
      inputTokens: null,
      outputTokens: null,
      artifacts: artifacts ?? { message },
    });
  }

  async flush(): Promise<void> {
    await this.logger.flush();
  }
}
