// Shared types for the LLM provider adapter.
// Callers always speak OpenAI-style tools + { role, content } messages; each
// provider translates internally.

export type Provider =
    | "claude"
    | "gemini"
    | "openai"
    | "openai-compatible"
    | "ollama";

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

export type UserApiKeys = {
    claude?: string | null;
    gemini?: string | null;
    openai?: string | null;
    openrouter?: string | null;
    courtlistener?: string | null;
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
    /**
     * Maximum time allowed for each provider response. Providers that do not
     * expose an abortable request may ignore this value.
     */
    requestTimeoutMs?: number;
};

export type StreamChatResult = {
    fullText: string;
};

export type ModelLocation = "cloud" | "local";

export type ConfiguredModel = {
    id: string;
    provider: Provider;
    location: ModelLocation;
    label?: string;
    apiModel?: string;
    modelName?: string;
    baseUrl?: string;
    apiKeyEnv?: string;
    apiKeyProvider?: keyof UserApiKeys;
    apiKey?: string;
    extraBody?: Record<string, unknown>;
};

export type CommitteeModel = {
    id: string;
    label?: string;
    members: Array<
        | string
        | {
              id?: string;
              model: string;
              label?: string;
              systemPrompt?: string;
          }
    >;
    chair: string;
    strategy?: "synthesize";
};
