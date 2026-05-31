// Shared types for the LLM provider adapter.
// Callers always speak OpenAI-style tools + { role, content } messages; each
// provider translates internally.

export type Provider = "claude" | "gemini" | "openai";

export type OpenAIToolSchema = {
    type: "function";
    function: {
        name: string;
        description: string;
        parameters: Record<string, unknown>;
    };
};

export type LlmMessage = {
    role: "user" | "assistant";
    content: string;
};

export type NormalizedToolCall = {
    id: string;
    name: string;
    input: Record<string, unknown>;
};

export type NormalizedToolResult = {
    tool_use_id: string;
    content: string;
};

export type StreamCallbacks = {
    onReasoningDelta?: (text: string) => void;
    onReasoningBlockEnd?: () => void;
    onContentDelta?: (text: string) => void;
    onToolCallStart?: (call: NormalizedToolCall) => void;
    /**
     * Fired when the provider's native web-search tool issues a search. These
     * searches run server-side (the provider executes them itself and folds
     * the results into its response), so they never reach `runTools`; this
     * callback exists purely so consumers can surface a "searching the web"
     * indicator. `query` is the search string when the provider exposes it.
     */
    onWebSearch?: (query?: string) => void;
};

export type UserApiKeys = {
    claude?: string | null;
    gemini?: string | null;
    openai?: string | null;
};

export type StreamChatParams = {
    model: string;
    systemPrompt: string;
    messages: LlmMessage[];
    tools?: OpenAIToolSchema[];
    maxIterations?: number;
    callbacks?: StreamCallbacks;
    runTools?: (calls: NormalizedToolCall[]) => Promise<NormalizedToolResult[]>;
    apiKeys?: UserApiKeys;
    /**
     * Enable provider-side reasoning/thinking. Off by default — should only
     * be turned on for interactive chat surfaces where the user actually
     * benefits from seeing the thought stream. Bulk extraction jobs and
     * one-shot completions should leave this off to save tokens and latency.
     */
    enableThinking?: boolean;
    /**
     * Enable the provider's native web-search tool (Anthropic `web_search`,
     * OpenAI Responses `web_search`, Gemini `googleSearch` grounding). The
     * provider runs searches server-side and incorporates results into its
     * answer; matching `onWebSearch` callbacks fire as searches happen. Off by
     * default — only interactive chat surfaces should opt in.
     */
    enableWebSearch?: boolean;
};

export type StreamChatResult = {
    fullText: string;
};
