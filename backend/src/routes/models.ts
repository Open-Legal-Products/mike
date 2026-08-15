import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { authHeaders } from "../lib/llm/ollama";
import { getUserApiKeys } from "../lib/userApiKeys";
import {
    OPENROUTER_API_BASE_URL,
    parseOpenRouterModelOptions,
} from "../lib/llm/openrouterCatalog";
import { safeErrorLog } from "../lib/safeError";

export const modelsRouter = Router();

// Live list of locally installed Ollama models, shaped like the frontend's
// ModelOption. Returns [] when Ollama is unreachable so the app still works.
modelsRouter.get("/ollama", requireAuth, async (_req, res) => {
    const base = (
        process.env.OLLAMA_BASE_URL?.trim() || "http://localhost:11434/v1"
    ).replace(/\/$/, "");
    try {
        const r = await fetch(`${base}/models`, { headers: authHeaders() });
        if (!r.ok) return void res.json({ models: [] });
        const data = (await r.json()) as { data?: { id: string }[] };
        const models = (data.data ?? []).map((m) => ({
            id: `ollama/${m.id}`,
            label: `${m.id} (local)`,
            group: "Local",
        }));
        res.json({ models });
    } catch {
        res.json({ models: [] });
    }
});

// Catalog visible to the authenticated user's OpenRouter account. The API key
// stays server-side; only model ids and display labels are returned.
export async function openRouterModelsHandler(
    _req: Request,
    res: Response,
): Promise<void> {
    const userId = res.locals.userId as string;
    try {
        const apiKeys = await getUserApiKeys(userId);
        const apiKey = apiKeys.openrouter?.trim();
        if (!apiKey) {
            return void res.status(400).json({
                detail: "OpenRouter API key is not configured.",
            });
        }

        const response = await fetch(`${OPENROUTER_API_BASE_URL}/models`, {
            signal: AbortSignal.timeout(15_000),
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: "application/json",
            },
        });
        if (!response.ok) {
            return void res.status(502).json({
                detail: "Unable to load the OpenRouter model catalog.",
            });
        }
        const models = parseOpenRouterModelOptions(await response.json());
        res.json({ models });
    } catch (error) {
        console.error(
            "[models/openrouter] catalog request failed",
            safeErrorLog(error),
        );
        res.status(502).json({
            detail: "Unable to load the OpenRouter model catalog.",
        });
    }
}

modelsRouter.get("/openrouter", requireAuth, openRouterModelsHandler);
