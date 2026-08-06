// Shared types for the LLM provider adapter.
// Callers always speak OpenAI-style tools + { role, content } messages; each
// provider translates internally.

/**
 * Provider identifier string — extensible, not a closed union.
 *
 * Because this is an open string type, the compiler can no longer enforce
 * exhaustive switches over providers.  Never branch on provider ids with a
 * catch-all that assumes a specific provider; for display names use
 * providerDisplayLabel() from the registry, which falls back to the raw id
 * for providers it does not know.
 */
export type Provider = string;

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
};

/**
 * Per-request API keys keyed by provider id.
 *
 * The named optional properties exist solely for IDE autocomplete on the
 * built-in providers — they are NOT a closed list.  The index signature
 * makes this map open: third-party providers (e.g. "ollama", "bedrock") carry
 * their credentials here without any changes to this file.  Callers access
 * keys via apiKeys[providerId], not via named property access.
 */
export type UserApiKeys = {
    claude?: string | null;
    gemini?: string | null;
    openai?: string | null;
    openrouter?: string | null;
    vercel?: string | null;
    "opencode-go"?: string | null;
    courtlistener?: string | null;
    [provider: string]: string | null | undefined;
};

/** Parameters for the single-shot non-streaming completeText() call. */
export type CompleteTextParams = {
    model: string;
    systemPrompt?: string;
    user: string;
    maxTokens?: number;
    apiKeys?: UserApiKeys;
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
    abortSignal?: AbortSignal;
};

export type StreamChatResult = {
    fullText: string;
};
