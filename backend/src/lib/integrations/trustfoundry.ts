import type { OpenAIToolSchema } from "../llm";
import type { ToolIntegration } from "./types";

const DEFAULT_BASE_URL = "https://api.trustfoundry.ai";
const MAX_SEARCH_EVENTS = 80;

const TRUSTFOUNDRY_TOOL_DISPLAY_NAMES: Record<string, string> = {
    trustfoundry_agentic_legal_search: "TrustFoundry Legal Research",
    trustfoundry_direct_legal_search: "TrustFoundry Legal Search",
    trustfoundry_get_search_results: "TrustFoundry Search Results",
    trustfoundry_describe_search_result: "TrustFoundry Authority Summary",
    trustfoundry_validate_citations: "TrustFoundry Citation Validation",
    trustfoundry_get_usage: "TrustFoundry Usage Check",
};

export const TRUSTFOUNDRY_TOOLS: OpenAIToolSchema[] = [
    {
        type: "function",
        function: {
            name: "trustfoundry_agentic_legal_search",
            description:
                "Run a broad TrustFoundry legal research search across laws, regulations, and case law. Use for open-ended legal research questions. When summarizing results, state that the research was run through TrustFoundry, cite authorities using citation text returned by the tool, and use Markdown links only when the tool returns a URL.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Natural-language legal research query.",
                    },
                    default_state: {
                        type: "string",
                        description:
                            "Default jurisdiction as a 2-letter uppercase state code or FED. Defaults to FED.",
                    },
                },
                required: ["query"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "trustfoundry_direct_legal_search",
            description:
                "Run a targeted TrustFoundry search for one legal source type. Use for specific cases, statutes, regulations, key facts, or exact-citation style searches. When summarizing results, state that the research was run through TrustFoundry, cite authorities using citation text returned by the tool, and use Markdown links only when the tool returns a URL.",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "Search query.",
                    },
                    state: {
                        type: "string",
                        description:
                            "Jurisdiction as a 2-letter uppercase state code or FED.",
                    },
                    model_type: {
                        type: "string",
                        enum: [
                            "case_question",
                            "law_question",
                            "reg_question",
                            "case_key_fact",
                        ],
                        description:
                            "Source/search type: case_question, law_question, reg_question, or case_key_fact.",
                    },
                },
                required: ["query", "state", "model_type"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "trustfoundry_get_search_results",
            description:
                "Retrieve a TrustFoundry search result set by UUID, including result item UUIDs, citations, URLs, excerpts, and metadata. Use only returned citations, URLs, and metadata when citing or linking authorities; do not invent source details.",
            parameters: {
                type: "object",
                properties: {
                    uuid: {
                        type: "string",
                        description:
                            "Search set UUID returned by a TrustFoundry search.",
                    },
                },
                required: ["uuid"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "trustfoundry_describe_search_result",
            description:
                "Retrieve a summarized legal description for one TrustFoundry search result item. Use item UUIDs returned from a search result set. Use only returned citations, URLs, and metadata when citing or linking authorities; do not invent source details.",
            parameters: {
                type: "object",
                properties: {
                    uuid: {
                        type: "string",
                        description:
                            "Search result item UUID returned by TrustFoundry.",
                    },
                    full_text: {
                        type: "boolean",
                        description:
                            "When true, request full text where supported.",
                    },
                },
                required: ["uuid"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "trustfoundry_validate_citations",
            description:
                "Extract and validate legal citations from user-provided text using TrustFoundry. State that citation validation was run through TrustFoundry. Treat the returned validation status as the source of truth for what TrustFoundry verified; unsupported or unable-to-process citations are not TrustFoundry-verified. Do not use model knowledge to upgrade a TrustFoundry non-verification into a verified citation.",
            parameters: {
                type: "object",
                properties: {
                    text: {
                        type: "string",
                        description:
                            "Text containing citations to extract and validate. Maximum 10,000 characters.",
                    },
                    context_before: {
                        type: "integer",
                        description:
                            "Characters before each citation to include as context, 0-250.",
                    },
                    context_after: {
                        type: "integer",
                        description:
                            "Characters after each citation to include as context, 0-250.",
                    },
                },
                required: ["text"],
            },
        },
    },
    {
        type: "function",
        function: {
            name: "trustfoundry_get_usage",
            description:
                "Check TrustFoundry usage, quota, credits, and billing status for the connected API key.",
            parameters: { type: "object", properties: {} },
        },
    },
];

type NdjsonParseResult = {
    events: unknown[];
    rest: string;
};

export class TrustFoundryApiError extends Error {
    status: number;
    requestId: string | null;
    retryAfter: string | null;
    code: string;

    constructor(params: {
        status: number;
        message: string;
        requestId?: string | null;
        retryAfter?: string | null;
        code?: string;
    }) {
        super(params.message);
        this.name = "TrustFoundryApiError";
        this.status = params.status;
        this.requestId = params.requestId ?? null;
        this.retryAfter = params.retryAfter ?? null;
        this.code = params.code ?? "trustfoundry_error";
    }
}

export function trustFoundryBaseUrl(env = process.env): string {
    return (env.TRUSTFOUNDRY_API_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(
        /\/+$/,
        "",
    );
}

export function parseNdjsonChunk(buffer: string): NdjsonParseResult {
    const events: unknown[] = [];
    const lines = buffer.split("\n");
    const rest = lines.pop() ?? "";

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
            events.push(JSON.parse(trimmed));
        } catch {
            throw new TrustFoundryApiError({
                status: 502,
                code: "malformed_response",
                message: "Malformed response from TrustFoundry.",
            });
        }
    }

    return { events, rest };
}

export function parseNdjsonChunks(chunks: string[]): unknown[] {
    let rest = "";
    const events: unknown[] = [];
    for (const chunk of chunks) {
        const parsed = parseNdjsonChunk(rest + chunk);
        events.push(...parsed.events);
        rest = parsed.rest;
    }
    const trailing = rest.trim();
    if (trailing) events.push(JSON.parse(trailing));
    return events;
}

export function mapTrustFoundryError(params: {
    status: number;
    bodyText: string;
    requestId?: string | null;
    retryAfter?: string | null;
}): TrustFoundryApiError {
    let remoteError = "";
    try {
        const parsed = JSON.parse(params.bodyText) as { error?: unknown };
        remoteError =
            typeof parsed.error === "string" ? parsed.error : params.bodyText;
    } catch {
        remoteError = params.bodyText;
    }

    if (params.status === 401) {
        return new TrustFoundryApiError({
            status: params.status,
            code: "invalid_api_key",
            requestId: params.requestId,
            message:
                "TrustFoundry API key is invalid or missing. Configure a valid TrustFoundry API key in the server environment.",
        });
    }

    if (params.status === 402) {
        return new TrustFoundryApiError({
            status: params.status,
            code: "insufficient_credits",
            requestId: params.requestId,
            message:
                remoteError || "TrustFoundry credits are insufficient for this request.",
        });
    }

    if (params.status === 429) {
        const isQuota = remoteError === "Quota exceeded";
        return new TrustFoundryApiError({
            status: params.status,
            code: isQuota ? "quota_exceeded" : "rate_limited",
            requestId: params.requestId,
            retryAfter: params.retryAfter,
            message: [
                isQuota
                    ? "TrustFoundry quota is exhausted."
                    : "TrustFoundry rate limit exceeded.",
                params.retryAfter
                    ? `Retry after ${params.retryAfter} seconds.`
                    : null,
            ]
                .filter(Boolean)
                .join(" "),
        });
    }

    return new TrustFoundryApiError({
        status: params.status,
        code: "request_failed",
        requestId: params.requestId,
        message:
            remoteError ||
            `TrustFoundry request failed with HTTP ${params.status}.`,
    });
}

export function formatTrustFoundryToolError(err: unknown): string {
    if (err instanceof TrustFoundryApiError) {
        return JSON.stringify({
            error: {
                code: err.code,
                message: err.message,
                status: err.status,
                request_id: err.requestId,
                retry_after: err.retryAfter,
            },
        });
    }
    return JSON.stringify({
        error: {
            code: "trustfoundry_error",
            message: err instanceof Error ? err.message : String(err),
        },
    });
}

export function isTrustFoundryToolName(name: string): boolean {
    return TRUSTFOUNDRY_TOOLS.some((tool) => tool.function.name === name);
}

export function trustFoundryToolDisplayName(name: string): string | null {
    return TRUSTFOUNDRY_TOOL_DISPLAY_NAMES[name] ?? null;
}

export function trustFoundryEnabled(env = process.env): boolean {
    return ["1", "true", "yes", "on"].includes(
        (env.TRUSTFOUNDRY_ENABLED ?? "").trim().toLowerCase(),
    );
}

export function trustFoundryApiKey(env = process.env): string | null {
    return env.TRUSTFOUNDRY_API_KEY?.trim() || null;
}


export function buildTrustFoundryRequest(params: {
    apiKey: string;
    path: string;
    init?: RequestInit;
    env?: NodeJS.ProcessEnv;
}): { url: string; init: RequestInit } {
    const init = params.init ?? {};
    const headers = new Headers(init.headers);
    headers.set("X-API-Key", params.apiKey);
    if (init.body && !headers.has("Content-Type")) {
        headers.set("Content-Type", "application/json");
    }

    return {
        url: `${trustFoundryBaseUrl(params.env)}${params.path}`,
        init: {
            ...init,
            headers,
        },
    };
}

async function trustFoundryFetch(
    apiKey: string,
    path: string,
    init: RequestInit = {},
): Promise<Response> {
    const request = buildTrustFoundryRequest({ apiKey, path, init });
    const response = await fetch(request.url, request.init);

    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw mapTrustFoundryError({
            status: response.status,
            bodyText,
            requestId: response.headers.get("X-Request-Id"),
            retryAfter: response.headers.get("Retry-After"),
        });
    }

    return response;
}

async function readNdjsonResponse(response: Response): Promise<unknown[]> {
    if (!response.body) return [];
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const events: unknown[] = [];
    let rest = "";

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const parsed = parseNdjsonChunk(
            rest + decoder.decode(value, { stream: true }),
        );
        events.push(...parsed.events);
        rest = parsed.rest;
    }

    const trailing = rest.trim();
    if (trailing) events.push(JSON.parse(trailing));
    return events;
}

function searchSummary(events: unknown[]) {
    const statuses: string[] = [];
    let searchSet: unknown = null;
    let confused: unknown = null;

    for (const event of events as Record<string, unknown>[]) {
        if (event.type === "citations_ready") searchSet = event.content;
        if (event.type === "confused") confused = event.content;
        if (
            (event.type === "thinking_delta" ||
                event.type === "search_start" ||
                event.type === "search_end") &&
            typeof event.content === "string" &&
            statuses.length < MAX_SEARCH_EVENTS
        ) {
            statuses.push(event.content);
        }
        if (event.type === "error") {
            throw new TrustFoundryApiError({
                status: 502,
                code: "stream_error",
                message:
                    typeof event.content === "object" &&
                    event.content &&
                    "message" in event.content
                        ? String(
                              (event.content as { message?: unknown }).message,
                          )
                        : "TrustFoundry search stream returned an error.",
            });
        }
    }

    return {
        search_set: searchSet,
        confused,
        statuses,
        event_count: events.length,
    };
}

function stringArg(
    args: Record<string, unknown>,
    name: string,
    fallback = "",
): string {
    const value = args[name];
    return typeof value === "string" && value.trim()
        ? value.trim()
        : fallback;
}

function intArg(
    args: Record<string, unknown>,
    name: string,
): number | undefined {
    const value = args[name];
    return typeof value === "number" && Number.isFinite(value)
        ? Math.trunc(value)
        : undefined;
}

export async function executeTrustFoundryTool(params: {
    name: string;
    args: Record<string, unknown>;
    apiKey: string;
}): Promise<string> {
    const { name, args, apiKey } = params;

    if (name === "trustfoundry_agentic_legal_search") {
        const response = await trustFoundryFetch(
            apiKey,
            "/public/v1/agentic-search",
            {
                method: "POST",
                body: JSON.stringify({
                    query: stringArg(args, "query"),
                    default_state: stringArg(args, "default_state", "FED"),
                }),
            },
        );
        return JSON.stringify(searchSummary(await readNdjsonResponse(response)));
    }

    if (name === "trustfoundry_direct_legal_search") {
        const response = await trustFoundryFetch(apiKey, "/public/v1/search", {
            method: "POST",
            body: JSON.stringify({
                query: stringArg(args, "query"),
                state: stringArg(args, "state", "FED"),
                model_type: stringArg(args, "model_type"),
            }),
        });
        return JSON.stringify(searchSummary(await readNdjsonResponse(response)));
    }

    if (name === "trustfoundry_get_search_results") {
        const uuid = encodeURIComponent(stringArg(args, "uuid"));
        const response = await trustFoundryFetch(
            apiKey,
            `/public/v1/search/results/${uuid}`,
        );
        return JSON.stringify(await response.json());
    }

    if (name === "trustfoundry_describe_search_result") {
        const uuid = encodeURIComponent(stringArg(args, "uuid"));
        const fullText = args.full_text === true ? "?full_text=true" : "";
        const response = await trustFoundryFetch(
            apiKey,
            `/public/v1/search/results/items/describe/${uuid}${fullText}`,
        );
        return JSON.stringify(await response.json());
    }

    if (name === "trustfoundry_validate_citations") {
        const response = await trustFoundryFetch(
            apiKey,
            "/public/v1/citation/validate",
            {
                method: "POST",
                body: JSON.stringify({
                    text: stringArg(args, "text"),
                    context_before: intArg(args, "context_before") ?? 0,
                    context_after: intArg(args, "context_after") ?? 0,
                }),
            },
        );
        return JSON.stringify(await response.json());
    }

    if (name === "trustfoundry_get_usage") {
        const response = await trustFoundryFetch(apiKey, "/public/v1/usage");
        return JSON.stringify(await response.json());
    }

    return JSON.stringify({
        error: {
            code: "tool_not_found",
            message: `TrustFoundry tool '${name}' is not available.`,
        },
    });
}

export const trustFoundryIntegration: ToolIntegration = {
    name: "trustfoundry",
    isEnabled: () => trustFoundryEnabled() && !!trustFoundryApiKey(),
    tools: () => TRUSTFOUNDRY_TOOLS,
    canHandle: isTrustFoundryToolName,
    displayName: trustFoundryToolDisplayName,
    run: async (toolCall, args) => {
        const apiKey = trustFoundryApiKey();
        if (!apiKey) {
            return {
                role: "tool",
                tool_call_id: toolCall.id,
                content: JSON.stringify({
                    error: {
                        code: "missing_api_key",
                        message:
                            "TrustFoundry is not configured for this Mike instance.",
                    },
                }),
            };
        }

        try {
            return {
                role: "tool",
                tool_call_id: toolCall.id,
                content: await executeTrustFoundryTool({
                    name: toolCall.function.name,
                    args,
                    apiKey,
                }),
            };
        } catch (err) {
            return {
                role: "tool",
                tool_call_id: toolCall.id,
                content: formatTrustFoundryToolError(err),
            };
        }
    },
};
