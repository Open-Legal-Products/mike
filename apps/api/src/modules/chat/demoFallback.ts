import {
    DEFAULT_MAIN_MODEL,
    DEMO_MODEL,
    providerForModel,
    resolveModel,
} from "../../lib/llm";

/**
 * Pick the model to actually run. If the requested model's provider has no
 * usable key (env or per-user), fall back to the keyless demo model so the user
 * gets a helpful placeholder instead of a raw provider auth error. An explicit
 * demo request, or a provider with a key present, is returned unchanged.
 *
 * Lives in its own module so both the streaming route (chat.routes) and
 * title generation (chat.service) can apply the same fallback without an
 * import cycle.
 */
export function resolveDemoFallback(
    requestedModel: string | null | undefined,
    apiKeys: Record<string, string | null | undefined>,
): string {
    const model = resolveModel(requestedModel, DEFAULT_MAIN_MODEL);
    if (model === DEMO_MODEL) return model;
    let provider: string;
    try {
        provider = providerForModel(model);
    } catch {
        return model; // unknown model — let the normal path surface the error
    }
    if (provider === "demo") return model;
    return apiKeys[provider]?.trim() ? model : DEMO_MODEL;
}
