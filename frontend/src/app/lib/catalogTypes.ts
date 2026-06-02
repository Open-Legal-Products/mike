/**
 * Shared catalog types — mirror of backend/src/lib/llm/catalogTypes.ts.
 * Keep these two files in sync; if they drift, the picker will silently
 * mis-render models because TypeScript can't cross-check the wire shape.
 */

export type ModelCapabilities = {
    /** Text in -> text out. The minimum bar for the chat picker. */
    chat: boolean;
    /** Supports function/tool calling. */
    tools: boolean;
    /** Supports server-sent event streaming. */
    streaming: boolean;
};

export type CatalogModel = {
    id: string;
    label: string;
    group: string;
    zdr?: boolean;
    capabilities: ModelCapabilities;
};
