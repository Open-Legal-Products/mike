// Shared types + helpers used across the tabular service files.
//
// These are module-internal: they are exported here so sibling files
// (tabular.prompt.ts, tabular.extract.ts, tabular.reviews.ts, …) can import
// them, but only the names re-exported by tabular.service.ts are part of the
// module's public surface.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { providerForModel, type Provider, type UserApiKeys } from "../../lib/llm";

export type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
export type Log = Pick<typeof logger, "error">;

// ---------------------------------------------------------------------------
// Model helpers
// ---------------------------------------------------------------------------

function providerLabel(provider: Provider): string {
    if (provider === "claude") return "Anthropic";
    if (provider === "openai") return "OpenAI";
    return "Gemini";
}

export type MissingApiKey = {
    provider: Provider;
    model: string;
    detail: string;
};

export function missingModelApiKey(
    model: string,
    apiKeys: UserApiKeys,
): MissingApiKey | null {
    const provider = providerForModel(model);
    if (apiKeys[provider]?.trim()) return null;
    return {
        provider,
        model,
        detail: `${providerLabel(provider)} API key is required to use ${model}. Add an API key or select a different tabular review model.`,
    };
}

// ---------------------------------------------------------------------------
// Cell content parsing
// ---------------------------------------------------------------------------

export function parseCellContent(
    raw: unknown,
): { summary: string; flag?: string; reasoning?: string } | null {
    if (!raw) return null;
    if (typeof raw === "object" && raw !== null && "summary" in raw) {
        const c = raw as {
            summary?: unknown;
            flag?: unknown;
            reasoning?: unknown;
        };
        return {
            summary: String(c.summary ?? ""),
            flag: (["green", "grey", "yellow", "red"] as const).includes(
                c.flag as "green",
            )
                ? (c.flag as string)
                : undefined,
            reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
        };
    }
    if (typeof raw === "string") {
        try {
            const p = JSON.parse(raw) as {
                summary?: unknown;
                value?: unknown;
                flag?: unknown;
                reasoning?: unknown;
            };
            return {
                summary: String(p.summary ?? p.value ?? "").trim(),
                flag: (["green", "grey", "yellow", "red"] as const).includes(
                    p.flag as "green",
                )
                    ? (p.flag as string)
                    : undefined,
                reasoning: typeof p.reasoning === "string" ? p.reasoning : "",
            };
        } catch {
            return { summary: raw, flag: "grey", reasoning: "" };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Extraction result / column shapes
// ---------------------------------------------------------------------------

export type CellResult = {
    summary: string;
    flag: "green" | "grey" | "yellow" | "red";
    reasoning: string;
};
export type Column = {
    index: number;
    name: string;
    prompt: string;
    format?: string;
    tags?: string[];
};
