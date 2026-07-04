import { type McpConnectorSummary } from "@/app/lib/mikeApi";

// Shared types, constants, and pure helpers for the Connectors page. Kept
// separate from page.tsx (the container) and the presentational components so
// each has a single, obvious home.

export type PendingMfaAction =
    | { type: "create" }
    | { type: "save"; connectorId: string }
    | { type: "clear-token"; connectorId: string }
    | { type: "delete"; connectorId: string }
    | { type: "refresh"; connectorId: string }
    | { type: "connector-enabled"; connectorId: string; enabled: boolean }
    | {
          type: "tool-enabled";
          connectorId: string;
          toolId: string;
          enabled: boolean;
      };

export type AddDraft = {
    name: string;
    serverUrl: string;
    bearerToken: string;
    customHeaders: string;
};

export type DetailDraft = AddDraft & {
    clearBearerToken: boolean;
};

export type AddStep = "form" | "working" | "auth" | "success";

export const emptyAddDraft: AddDraft = {
    name: "",
    serverUrl: "",
    bearerToken: "",
    customHeaders: "",
};

export type McpOAuthPopupMessage = {
    type?: string;
    success?: boolean;
    connectorId?: string;
    detail?: string;
};

export const mcpOAuthMessageOrigin = new URL(
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001",
).origin;

export function parseCustomHeaders(raw: string): Record<string, string> | undefined {
    const text = raw.trim();
    if (!text) return undefined;
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Custom headers must be a JSON object.");
    }
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
        if (typeof value !== "string") {
            throw new Error("Custom header values must be strings.");
        }
        headers[key] = value;
    }
    return headers;
}

export function isGoogleMcpConnector(connector: McpConnectorSummary) {
    try {
        return new URL(connector.serverUrl).hostname
            .toLowerCase()
            .endsWith("googleapis.com");
    } catch {
        return false;
    }
}
