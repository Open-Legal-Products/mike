import type { OpenAIToolSchema } from "../llm";
import { trustFoundryIntegration } from "./trustfoundry";
import type {
    IntegrationToolCall,
    IntegrationToolResult,
    ToolIntegration,
} from "./types";

const integrations: ToolIntegration[] = [trustFoundryIntegration];

export function configuredIntegrationTools(): OpenAIToolSchema[] {
    return integrations.flatMap((integration) =>
        integration.isEnabled() ? integration.tools() : [],
    );
}

export function withConfiguredIntegrationTools(
    tools: OpenAIToolSchema[],
): OpenAIToolSchema[] {
    return [...tools, ...configuredIntegrationTools()];
}

export function integrationToolDisplayName(toolName: string): string | null {
    const integration = integrations.find(
        (candidate) =>
            candidate.isEnabled() && candidate.canHandle(toolName),
    );
    return integration?.displayName(toolName) ?? null;
}

export async function runConfiguredIntegrationToolCall(
    toolCall: IntegrationToolCall,
    args: Record<string, unknown>,
): Promise<IntegrationToolResult | null> {
    const integration = integrations.find(
        (candidate) =>
            candidate.isEnabled() && candidate.canHandle(toolCall.function.name),
    );

    return integration ? integration.run(toolCall, args) : null;
}
