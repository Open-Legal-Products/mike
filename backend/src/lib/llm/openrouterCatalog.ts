export const OPENROUTER_MODEL_PREFIX = "openrouter/";
export const OPENROUTER_API_BASE_URL = "https://openrouter.ai/api/v1";

export type OpenRouterModelOption = {
    id: string;
    label: string;
    group: "OpenRouter";
};

export function isOpenRouterModelId(id: string): boolean {
    if (!id.startsWith(OPENROUTER_MODEL_PREFIX)) return false;
    const apiId = id.slice(OPENROUTER_MODEL_PREFIX.length);
    return (
        apiId.length > 0 &&
        apiId.length <= 256 &&
        apiId.trim() === apiId &&
        !/[\s\u0000-\u001f]/u.test(apiId)
    );
}

export function openRouterApiModel(id: string): string | null {
    if (!isOpenRouterModelId(id)) return null;
    return id.slice(OPENROUTER_MODEL_PREFIX.length);
}

export function parseOpenRouterModelOptions(
    payload: unknown,
): OpenRouterModelOption[] {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return [];
    }
    const data = (payload as { data?: unknown }).data;
    if (!Array.isArray(data)) return [];

    const byId = new Map<string, OpenRouterModelOption>();
    for (const value of data) {
        if (!value || typeof value !== "object" || Array.isArray(value))
            continue;
        const row = value as Record<string, unknown>;
        const apiId = typeof row.id === "string" ? row.id.trim() : "";
        const id = `${OPENROUTER_MODEL_PREFIX}${apiId}`;
        if (!isOpenRouterModelId(id)) continue;
        const name = typeof row.name === "string" ? row.name.trim() : "";
        byId.set(id, {
            id,
            label: name || apiId,
            group: "OpenRouter",
        });
    }

    return [...byId.values()].sort((left, right) =>
        left.label.localeCompare(right.label),
    );
}
