/**
 * GET /concentrate/models
 *
 * Fetches the user's authorized Concentrate model catalog. Returns an
 * empty list when no Concentrate key is configured. Results are cached
 * in-process for 5 minutes since the catalog rarely changes within a
 * single session and the Concentrate /v1/models endpoint is the bottleneck
 * for the model picker UX.
 */
import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { getUserApiKeys } from "../lib/userSettings";

export const concentrateModelsRouter = Router();

const DEFAULT_MODELS_URL = "https://api.concentrate.ai/v1/models";

function modelsUrl(): string {
    // Derive /v1/models from CONCENTRATE_RESPONSES_URL when set so one env var
    // switches both the chat endpoint and the catalog endpoint together.
    const responses = process.env.CONCENTRATE_RESPONSES_URL?.trim();
    if (responses) return responses.replace(/\/responses$/, "/models");
    return DEFAULT_MODELS_URL;
}

type ConcentrateModel = {
    id: string;
    name: string;
    author: string;
};

type CacheEntry = {
    models: ConcentrateModel[];
    fetchedAt: number;
};

const CACHE_TTL_MS = 5 * 60 * 1000;
let cache: CacheEntry | null = null;

function resolveKey(userKey?: string | null): string {
    return userKey?.trim() || process.env.CONCENTRATE_API_KEY?.trim() || "";
}

type RawModel = {
    slug?: string;
    name?: string;
    author?: { slug?: string };
};

async function fetchModelsFromApi(key: string): Promise<ConcentrateModel[]> {
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
    const models = Array.isArray(json)
        ? json
        : ((json as { data?: unknown[] }).data ?? []);
    return (models as RawModel[]).map((m) => ({
        id: m.slug ?? "",
        name: m.name ?? m.slug ?? "",
        author: m.author?.slug ?? "unknown",
    }));
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
            res.json({ models });
        } catch (err) {
            console.error("[concentrate-models]", err);
            res.json({ models: cache?.models ?? [] });
        }
    },
);
