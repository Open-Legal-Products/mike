/**
 * GET /providers/:provider/models
 *
 * Returns the authorized model catalog for a direct provider (anthropic,
 * google, openai) with capability flags attached. Returns an empty list
 * when no key is configured.
 *
 * The picker filters on capabilities.chat — see catalogTypes.ts. Each
 * fetcher below populates capabilities EXPLICITLY from the provider's own
 * signals; defaults are all-false so a new model class that nobody has
 * taught Mike about is hidden by default rather than slipping through.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { getUserApiKeys } from "../lib/userSettings";
import {
    ZERO_CAPABILITIES,
    type ProviderCatalogModel,
} from "../lib/llm/catalogTypes";

export const providerModelsRouter = Router();

type CacheEntry = { models: ProviderCatalogModel[]; fetchedAt: number };
const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

function cacheKey(provider: string, key: string): string {
    return `${provider}:${key.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------
//
// Anthropic's /v1/models endpoint only returns chat-capable Claude models —
// they ship embeddings and other modalities behind separate product lines.
// Every claude- model returned supports streaming and tool use per Anthropic
// docs. Confidence on these capabilities is high.

type AnthropicModel = {
    type?: string;
    id?: string;
    display_name?: string;
};

async function fetchAnthropic(key: string): Promise<ProviderCatalogModel[]> {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=100", {
        headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
        },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `Anthropic /v1/models failed (${res.status}): ${text || res.statusText}`,
        );
    }
    const json = (await res.json()) as { data?: AnthropicModel[] };
    const all = (json.data ?? []).filter(
        (m) => !!m.id && m.id.startsWith("claude-"),
    );

    const bareSlug = (id: string) => id.replace(/-\d{8}$/, "");
    const cleanLabel = (s: string) =>
        s.replace(/\s*\(\d{4}-\d{2}-\d{2}\)\s*$/, "");

    const seen = new Map<string, ProviderCatalogModel>();
    for (const m of all) {
        const id = bareSlug(m.id!);
        if (seen.has(id)) continue;
        seen.set(id, {
            id,
            label: cleanLabel(m.display_name ?? m.id!),
            group: "Anthropic",
            capabilities: { chat: true, tools: true, streaming: true },
        });
    }
    return [...seen.values()];
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
//
// OpenAI's /v1/models is the weakest signal of the three — no capability
// flags, no modality info, just IDs. We have to encode our knowledge of
// each family explicitly. Anything not in the chat-family allowlist is
// hidden. When OpenAI ships a new family (e.g. "o5"), it won't appear in
// the picker until this list is extended — which is the correct failure
// mode (hidden, not broken).

type OpenAIModel = {
    id?: string;
    object?: string;
    owned_by?: string;
};

function openaiLabel(id: string): string {
    if (id === "chat-latest") return "GPT-latest";
    return id
        .replace(/^gpt-/, "GPT-")
        .replace(/-chat-latest$/, "-latest")
        .replace(/-mini\b/i, " Mini")
        .replace(/-nano\b/i, " Nano")
        .replace(/-turbo\b/i, " Turbo");
}

/**
 * Per-family capability table. Each entry is a regex that matches a family
 * of model IDs plus the capabilities we know that family supports through
 * the Responses API (which is what Mike calls). Entries are evaluated in
 * order; the first match wins. Add a new entry when OpenAI ships a new
 * chat family. Anything not matched is hidden.
 */
const OPENAI_FAMILIES: Array<{
    test: RegExp;
    chat: boolean;
    tools: boolean;
    streaming: boolean;
}> = [
    // chat-latest aliases (chat-latest, gpt-5-chat-latest, gpt-5.1-chat-latest, etc.)
    { test: /^(gpt-[\w.]*-)?chat-latest$/, chat: true, tools: true, streaming: true },
    // gpt-5* family — base, versioned, dated, and pro variants
    { test: /^gpt-5(\.\d+)?(-(mini|nano|turbo|pro))?(-\d{4}-\d{2}-\d{2}|-\d+)?$/, chat: true, tools: true, streaming: true },
    // gpt-4o, gpt-4.1, gpt-4-turbo etc. with optional date stamp
    { test: /^gpt-4(o|\.1|\.5)?(-(mini|nano|turbo))?(-\d{4}-\d{2}-\d{2})?$/, chat: true, tools: true, streaming: true },
    // o-series reasoning models: o1, o3, o4-mini, o1-pro, o3-pro, dated variants
    { test: /^o[1-9](-(mini|preview|pro))?(-\d{4}-\d{2}-\d{2})?$/, chat: true, tools: true, streaming: true },
];

function openaiCapabilities(id: string): ProviderCatalogModel["capabilities"] {
    // Hard blocklist for non-chat surfaces that share the gpt-/o prefix.
    if (
        id.includes("audio") ||
        id.includes("image") ||
        id.includes("tts") ||
        id.includes("whisper") ||
        id.includes("transcribe") ||
        id.includes("embedding") ||
        id.includes("moderation") ||
        id.includes("realtime") ||
        id.includes("search") ||
        id.includes("codex") ||
        id.includes("deep-research") ||
        id.startsWith("ft:")
    ) {
        return { ...ZERO_CAPABILITIES };
    }
    for (const family of OPENAI_FAMILIES) {
        if (family.test.test(id)) {
            return {
                chat: family.chat,
                tools: family.tools,
                streaming: family.streaming,
            };
        }
    }
    return { ...ZERO_CAPABILITIES };
}

async function fetchOpenAI(key: string): Promise<ProviderCatalogModel[]> {
    const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `OpenAI /v1/models failed (${res.status}): ${text || res.statusText}`,
        );
    }
    const json = (await res.json()) as { data?: OpenAIModel[] };
    return (json.data ?? [])
        .filter((m) => !!m.id)
        .map((m) => ({
            id: m.id!,
            label: openaiLabel(m.id!),
            group: "OpenAI" as const,
            capabilities: openaiCapabilities(m.id!),
        }));
}

// ---------------------------------------------------------------------------
// Google (Gemini)
// ---------------------------------------------------------------------------
//
// Google's /v1beta/models is mixed: chat, image generation, TTS, audio
// dialog, embeddings, AQA, and Live API all live in one list. We use two
// signals together: supportedGenerationMethods includes generateContent
// (necessary) AND the ID does NOT match a specialized-purpose substring
// (sufficient). When Google ships a new specialized variant, the new
// substring needs to be added here — but a chat variant with a NEW name
// pattern will still be flagged chat:true correctly because the only
// thing it can fail is the substring blocklist, not the positive signal.

type GeminiModel = {
    name?: string;
    displayName?: string;
    supportedGenerationMethods?: string[];
};

const GEMINI_NON_CHAT_SUBSTRINGS = [
    "image",     // Nano Banana et al — image generation
    "vision",    // legacy vision-only
    "tts",       // text-to-speech
    "audio",     // native audio dialog
    "embed",     // embeddings
    "embedding", // embeddings (alt spelling)
    "aqa",       // attributed question answering
    "live",      // Live API streaming
    "thinking",  // experimental thinking dialog
    "realtime",  // realtime API
];

function geminiCapabilities(
    id: string,
    methods: string[],
): ProviderCatalogModel["capabilities"] {
    if (!methods.includes("generateContent")) return { ...ZERO_CAPABILITIES };
    for (const bad of GEMINI_NON_CHAT_SUBSTRINGS) {
        if (id.includes(bad)) return { ...ZERO_CAPABILITIES };
    }
    if (id.startsWith("gemini-1")) return { ...ZERO_CAPABILITIES };
    if (/^gemini-2\.0(-|$)/.test(id)) return { ...ZERO_CAPABILITIES };
    if (/-preview-\d+/.test(id) || /-exp-\d+/.test(id)) {
        return { ...ZERO_CAPABILITIES };
    }
    // Every surviving Gemini chat model supports function calling and
    // streaming via the SDK we use (@google/genai).
    return { chat: true, tools: true, streaming: true };
}

async function fetchGemini(key: string): Promise<ProviderCatalogModel[]> {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(key)}`,
    );
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `Google /v1beta/models failed (${res.status}): ${text || res.statusText}`,
        );
    }
    const json = (await res.json()) as { models?: GeminiModel[] };
    return (json.models ?? [])
        .filter((m) => (m.name ?? "").startsWith("models/gemini-"))
        .map((m) => {
            const id = m.name!.replace(/^models\//, "");
            return {
                id,
                label: m.displayName ?? id,
                group: "Google" as const,
                capabilities: geminiCapabilities(
                    id,
                    m.supportedGenerationMethods ?? [],
                ),
            };
        });
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

type ProviderConfig = {
    fetch: (key: string) => Promise<ProviderCatalogModel[]>;
    keyField: "claude" | "gemini" | "openai";
    envKey: string[];
};

const PROVIDERS: Record<string, ProviderConfig> = {
    anthropic: {
        fetch: fetchAnthropic,
        keyField: "claude",
        envKey: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    },
    openai: {
        fetch: fetchOpenAI,
        keyField: "openai",
        envKey: ["OPENAI_API_KEY"],
    },
    google: {
        fetch: fetchGemini,
        keyField: "gemini",
        envKey: ["GEMINI_API_KEY"],
    },
};

function resolveKey(envKeys: string[], userKey?: string | null): string {
    const fromUser = userKey?.trim();
    if (fromUser) return fromUser;
    for (const name of envKeys) {
        const v = process.env[name]?.trim();
        if (v) return v;
    }
    return "";
}

providerModelsRouter.get(
    "/:provider/models",
    requireAuth,
    async (req: Request, res: Response): Promise<void> => {
        const provider = req.params.provider;
        const config = PROVIDERS[provider];
        if (!config) {
            res.status(404).json({ models: [], detail: "Unknown provider" });
            return;
        }

        try {
            const userId = res.locals.userId as string;
            const apiKeys = await getUserApiKeys(userId);
            const key = resolveKey(config.envKey, apiKeys[config.keyField]);
            if (!key) {
                res.json({ models: [] });
                return;
            }

            const ck = cacheKey(provider, key);
            const hit = cache.get(ck);
            if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
                res.json({ models: hit.models });
                return;
            }

            const models = await config.fetch(key);
            cache.set(ck, { models, fetchedAt: Date.now() });
            res.json({ models });
        } catch (err) {
            console.error(`[provider-models:${provider}]`, err);
            res.json({ models: [] });
        }
    },
);
