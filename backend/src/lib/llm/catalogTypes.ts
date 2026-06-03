/**
 * Shared catalog types — the contract between the provider-models routes,
 * the Concentrate models route, and the picker UI.
 *
 * The capability flags are the load-bearing piece. A model can only be
 * shown in Mike's chat picker if `capabilities.chat === true`. Capabilities
 * default to FALSE — every fetcher has to prove a model is chat-capable
 * by setting the flag explicitly. This is the safety net: when a provider
 * ships a new model class (audio dialog, image generation, embedding, etc.)
 * Mike's UI hides it by default rather than letting it slip through and
 * fail at request time.
 */

export type ModelCapabilities = {
    /**
     * Text in -> text out. The minimum bar for the chat picker. Picker
     * surfaces only models where this is true.
     */
    chat: boolean;

    /**
     * Supports function/tool calling. Required by Mike's agentic tabular
     * review and assistant tool surfaces. Some chat models (early o1) do
     * not, even though they support text in/out — those should still appear
     * in the picker for simple completions but be marked unavailable to
     * tool-using callers.
     */
    tools: boolean;

    /**
     * Supports server-sent event streaming. Mike's chat UI assumes
     * streaming and would silently buffer the whole response otherwise.
     */
    streaming: boolean;
};

export type ProviderCatalogModel = {
    /** Bare model slug as recognized by the routing layer. */
    id: string;
    /** Display label shown in the picker. */
    label: string;
    /** Author group for the picker section header. */
    group: "Anthropic" | "Google" | "OpenAI" | string;
    /** True when at least one Concentrate-side provider is ZDR-certified. */
    zdr?: boolean;
    /**
     * Strict capability flags. Defaults to all-false; the fetcher must
     * explicitly opt a model in.
     */
    capabilities: ModelCapabilities;
};

export const ZERO_CAPABILITIES: ModelCapabilities = {
    chat: false,
    tools: false,
    streaming: false,
};
