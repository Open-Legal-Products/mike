/**
 * GET /concentrate/models
 *
 * Fetches the user's authorized Concentrate model catalog. Returns an
 * empty list when no Concentrate key is configured. Results are cached
 * in-process for 5 minutes.
 *
 * Two filters apply server-side:
 *   1. At least one Concentrate-side provider must be ZDR-certified
 *      (Concentrate is positioned as the privacy lane in Mike's picker,
 *      so non-ZDR-only models would defeat the purpose).
 *   2. The model must be chat-capable per its supports object — text
 *      input is supported AND the model is not an embedding / image-only
 *      / TTS / audio-only model. Capabilities are computed here from
 *      Concentrate's authoritative supports payload and returned to the
 *      frontend on every model, so the picker doesn't need provider-
 *      specific gating logic of its own.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { getUserApiKeys } from "../lib/userSettings";
import { setZdrModels } from "../lib/llm/concentrateCatalog";
import {
    ZERO_CAPABILITIES,
    type ModelCapabilities,
    type ProviderCatalogModel,
} from "../lib/llm/catalogTypes";

export const concentrateModelsRouter = Router();

const DEFAULT_MODELS_URL = "https://api.concentrate.ai/v1/models";

function modelsUrl(): string {
    const responses = process.env.CONCENTRATE_RESPONSES_URL?.trim();
    if (responses) return responses.replace(/\/responses$/, "/models");
    return DEFAULT_MODELS_URL;
}

type CacheEntry = {
    models: ProviderCatalogModel[];
    fetchedAt: number;
};
const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

function resolveKey(userKey?: string | null): string {
    return userKey?.trim() || process.env.CONCENTRATE_API_KEY?.trim() || "";
}

// ---------------------------------------------------------------------------
// Concentrate response shape (only the parts we read)
// ---------------------------------------------------------------------------

type ZdrInfo = false | { policy_url?: string; certificate_url?: string };

type SupportsInput = {
    text?: boolean;
    image?: Record<string, boolean>;
    file?: Record<string, boolean>;
    audio?: Record<string, boolean>;
};

type SupportsTools = {
    function_calling?: boolean;
};

type RawProvider = {
    zdr?: ZdrInfo;
    supports?: {
        input?: SupportsInput;
        tools?: SupportsTools;
        streaming?: boolean;
    };
};

type RawModel = {
    slug?: string;
    name?: string;
    author?: { slug?: string; display_name?: string };
    providers?: Record<string, RawProvider>;
};

// ---------------------------------------------------------------------------
// Capability + ZDR derivation
// ---------------------------------------------------------------------------

function authorGroup(slug: string, displayName?: string): string {
    if (displayName) return displayName;
    if (slug === "anthropic") return "Anthropic";
    if (slug === "openai") return "OpenAI";
    if (slug === "google") return "Google";
    return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function isZdrProvider(p: RawProvider): boolean {
    return !!p.zdr;
}

/**
 * Derive capabilities from Concentrate's provider supports payload. A
 * model is chat-capable iff at least one ZDR provider for it advertises
 * text input. We require ZDR specifically (not just any provider with
 * text) because Mike only routes ZDR models through Concentrate — if
 * the only text-supporting provider is non-ZDR, Mike wouldn't route to
 * it through this lane anyway.
 *
 * The slug itself is a backstop signal: image/audio/TTS/embedding model
 * families get their capabilities zeroed even if the supports object
 * accidentally says otherwise, because Mike's adapter can't drive them.
 */
function deriveCapabilities(m: RawModel): ModelCapabilities {
    const slug = m.slug ?? "";

    // Slug-shape blocklist — applies regardless of what supports says.
    const slugLower = slug.toLowerCase();
    const nonChatHints = [
        "embedding",
        "embed",
        "tts",
        "whisper",
        "transcribe",
        "image",
        "vision-only",
        "moderation",
        "audio-",
        "-audio",
        "realtime",
        "dall-e",
    ];
    for (const bad of nonChatHints) {
        if (slugLower.includes(bad)) return { ...ZERO_CAPABILITIES };
    }

    const providers = m.providers ?? {};
    let chat = false;
    let tools = false;
    let streaming = false;
    for (const p of Object.values(providers)) {
        if (!isZdrProvider(p)) continue;
        const sup = p.supports ?? {};
        if (sup.input?.text === true) chat = true;
        if (sup.tools?.function_calling === true) tools = true;
        // Concentrate doesn't expose a streaming flag explicitly in the
        // supports map we've sampled. Streaming through the Responses API
        // is supported uniformly by all of Concentrate's ZDR providers,
        // so when chat is true we treat streaming as true. If that turns
        // out wrong for some future entry, this is the one place to fix.
        if (chat) streaming = true;
    }
    return { chat, tools, streaming };
}

// ---------------------------------------------------------------------------
// Fetch + transform
// ---------------------------------------------------------------------------

async function fetchModelsFromApi(
    key: string,
): Promise<ProviderCatalogModel[]> {
    const res = await fetch(modelsUrl(), {
        headers: { Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
            `Concentrate /v1/models failed (${res.status}): ${text || res.statusText}`,
        );
    }
    const json = await res.json();
    const raw = Array.isArray(json)
        ? json
        : ((json as { data?: unknown[] }).data ?? []);

    return (raw as RawModel[])
        .filter((m) => {
            // Need at least one ZDR provider for the model to be relevant
            // in Mike's privacy-first Concentrate lane.
            const providers = m.providers ?? {};
            return Object.values(providers).some(isZdrProvider);
        })
        .map((m) => ({
            id: m.slug ?? "",
            label: m.name ?? m.slug ?? "",
            group: authorGroup(
                m.author?.slug ?? "unknown",
                m.author?.display_name,
            ),
            zdr: true,
            capabilities: deriveCapabilities(m),
        }))
        .filter((m) => !!m.id);
}

concentrateModelsRouter.get(
    "/",
    requireAuth,
    async (_req: Request, res: Response): Promise<void> => {
        try {
            const userId = res.locals.userId as string;
            const apiKeys = await getUserApiKeys(userId);
            const key = resolveKey(apiKeys.concentrate);

            if (!key) {
                res.json({ models: [] });
                return;
            }

            if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
                res.json({ models: cache.models });
                return;
            }

            const models = await fetchModelsFromApi(key);
            cache = { models, fetchedAt: Date.now() };
            // Publish the chat-capable ZDR set to the routing layer so chat
            // requests can enforce "ZDR routes through Concentrate" server
            // side, and reject non-chat IDs entirely.
            setZdrModels(
                models
                    .filter((m) => m.capabilities.chat)
                    .map((m) => ({ id: m.id })),
            );
            res.json({ models });
        } catch (err) {
            console.error("[concentrate-models]", err);
            res.json({ models: cache?.models ?? [] });
        }
    },
);
