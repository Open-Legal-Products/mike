// Shared agentic streaming loop for all LLM providers.
//
// Each provider (Claude, OpenAI, Gemini) re-implemented the same skeleton:
// iterate up to `maxIterations`, stream one turn (emitting content/reasoning
// deltas and tool-call starts), accumulate `fullText`, collect tool calls and —
// if any — run them and feed the results back into provider-specific message
// state for the next turn. That triplication let the loop logic drift between
// providers, so the skeleton lives here once and each provider supplies only a
// thin "session" that owns its SDK call, event parsing, follow-up message
// state, and callback firing.

import type {
    NormalizedToolCall,
    NormalizedToolResult,
    StreamCallbacks,
    StreamChatParams,
    StreamChatResult,
} from "./types";

export type TurnContext = {
    iter: number;
    callbacks: StreamCallbacks;
};

export type TurnResult = {
    // Tool calls discovered this turn. The session is responsible for having
    // already emitted each via `onToolCallStart` (ordering is provider-specific
    // and observable, so the driver never fires callbacks itself).
    toolCalls: NormalizedToolCall[];
    // Text the driver should append to `fullText` for this turn.
    textForFullText: string;
    // Provider hard-stop (e.g. Claude `stop_reason !== "tool_use"`): ends the
    // loop even if stray tool calls are present.
    stop?: boolean;
};

export type ProviderSession = {
    runTurn(ctx: TurnContext): Promise<TurnResult>;
    recordToolResults(
        calls: NormalizedToolCall[],
        results: NormalizedToolResult[],
    ): void;
};

export type SessionFactory = (params: StreamChatParams) => ProviderSession;

export async function runStreamingLoop(
    params: StreamChatParams,
    createSession: SessionFactory,
): Promise<StreamChatResult> {
    const maxIter = params.maxIterations ?? 10;
    const callbacks = params.callbacks ?? {};
    const { runTools } = params;
    const session = createSession(params);
    let fullText = "";

    for (let iter = 0; iter < maxIter; iter++) {
        const turn = await session.runTurn({ iter, callbacks });
        fullText += turn.textForFullText;
        if (turn.stop || !turn.toolCalls.length || !runTools) break;
        const results = await runTools(turn.toolCalls);
        session.recordToolResults(turn.toolCalls, results);
    }

    return { fullText };
}
