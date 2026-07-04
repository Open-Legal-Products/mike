import type { OpenAIToolSchema } from "./types";

// ---------------------------------------------------------------------------
// Tool-schema adapters
// ---------------------------------------------------------------------------
// Callers hand us OpenAI-style tool definitions. Provider-specific converters
// live here so the rest of the code never has to think about it.

export type ClaudeTool = {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
};

export function toClaudeTools(tools: OpenAIToolSchema[]): ClaudeTool[] {
    return tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        input_schema: normalizeSchema(t.function.parameters),
    }));
}

export type GeminiFunctionDeclaration = {
    name: string;
    description: string;
    parameters?: Record<string, unknown>;
};

export function toGeminiTools(tools: OpenAIToolSchema[]): GeminiFunctionDeclaration[] {
    return tools.map((t) => {
        const params = normalizeGeminiSchema(t.function.parameters);
        // Gemini rejects `{ type: "object", properties: {} }` with no fields
        // present; omit the parameters key entirely when empty.
        const hasProps =
            params &&
            typeof params === "object" &&
            Object.keys((params as { properties?: Record<string, unknown> }).properties ?? {}).length > 0;
        return {
            name: t.function.name,
            description: t.function.description,
            ...(hasProps ? { parameters: params } : {}),
        };
    });
}

// ---------------------------------------------------------------------------
// Schema normalization
// ---------------------------------------------------------------------------
// The OpenAI tool schemas in the codebase already use plain JSON-Schema-lite
// shape. Both Claude and Gemini accept that shape. We only sanitise a couple
// of edge cases: `integer` is accepted by both, but we make sure arrays have
// `items` and objects have `properties` so Gemini doesn't error.

function normalizeSchema(schema: unknown): Record<string, unknown> {
    if (!schema || typeof schema !== "object") {
        return { type: "object", properties: {} };
    }
    const s = schema as Record<string, unknown>;
    const type = s.type;
    const out: Record<string, unknown> = { ...s };

    if (type === "object") {
        const props = (s.properties as Record<string, unknown>) ?? {};
        const normProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(props)) {
            normProps[k] = normalizeSchema(v);
        }
        out.properties = normProps;
    }
    if (type === "array" && s.items) {
        out.items = normalizeSchema(s.items);
    }
    return out;
}

const GEMINI_SCHEMA_KEYS = new Set([
    "type",
    "description",
    "enum",
    "format",
    "items",
    "nullable",
    "properties",
    "required",
]);

function normalizeGeminiSchema(schema: unknown): Record<string, unknown> {
    return normalizeGeminiSchemaNode(schema, schema, new Set());
}

function normalizeGeminiSchemaNode(
    schema: unknown,
    root: unknown,
    seenRefs: Set<string>,
): Record<string, unknown> {
    if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
        return { type: "object", properties: {} };
    }

    const s = schema as Record<string, unknown>;
    const ref = typeof s.$ref === "string" ? s.$ref : null;
    if (ref) {
        const resolved = resolveLocalJsonRef(root, ref);
        if (resolved && !seenRefs.has(ref)) {
            return normalizeGeminiSchemaNode(
                resolved,
                root,
                new Set([...seenRefs, ref]),
            );
        }
        return { type: "string" };
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(s)) {
        if (!GEMINI_SCHEMA_KEYS.has(key)) continue;
        if (key.startsWith("$") || key.startsWith("x-")) continue;
        out[key] = value;
    }

    const type = normalizeGeminiType(out.type);
    out.type = type;

    if (type === "object") {
        const props =
            s.properties && typeof s.properties === "object" && !Array.isArray(s.properties)
                ? (s.properties as Record<string, unknown>)
                : {};
        const normProps: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(props)) {
            normProps[key] = normalizeGeminiSchemaNode(value, root, seenRefs);
        }
        out.properties = normProps;
        if (Array.isArray(s.required)) {
            out.required = s.required.filter(
                (name): name is string =>
                    typeof name === "string" && Object.prototype.hasOwnProperty.call(normProps, name),
            );
        } else {
            delete out.required;
        }
        return out;
    }

    delete out.properties;
    delete out.required;

    if (type === "array") {
        out.items = normalizeGeminiSchemaNode(s.items, root, seenRefs);
    } else {
        delete out.items;
    }

    return out;
}

function normalizeGeminiType(value: unknown): string {
    if (Array.isArray(value)) {
        const nonNull = value.find(
            (item): item is string => typeof item === "string" && item !== "null",
        );
        return normalizeGeminiType(nonNull);
    }
    if (typeof value !== "string" || !value) return "object";
    if (value === "integer") return "number";
    if (
        value === "object" ||
        value === "array" ||
        value === "string" ||
        value === "number" ||
        value === "boolean"
    ) {
        return value;
    }
    return "string";
}

function resolveLocalJsonRef(root: unknown, ref: string): unknown {
    if (!ref.startsWith("#/")) return null;
    const parts = ref
        .slice(2)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
    let cursor = root;
    for (const part of parts) {
        if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
            return null;
        }
        cursor = (cursor as Record<string, unknown>)[part];
    }
    return cursor;
}
