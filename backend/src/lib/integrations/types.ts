import type { OpenAIToolSchema } from "../llm";

export type IntegrationToolCall = {
    id: string;
    function: { name: string; arguments: string };
};

export type IntegrationToolResult = {
    role: "tool";
    tool_call_id: string;
    content: string;
};

export type ToolIntegration = {
    name: string;
    isEnabled: () => boolean;
    tools: () => OpenAIToolSchema[];
    canHandle: (toolName: string) => boolean;
    displayName: (toolName: string) => string | null;
    run: (
        toolCall: IntegrationToolCall,
        args: Record<string, unknown>,
    ) => Promise<IntegrationToolResult>;
};
