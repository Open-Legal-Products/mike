import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { listOllamaModels } from "../lib/llm";

export const ollamaRouter = Router();

ollamaRouter.get("/models", requireAuth, async (_req, res) => {
    try {
        const models = await listOllamaModels();
        res.json({ models, available: models.length > 0 });
    } catch (err) {
        console.error("[ollama/models]", err);
        res.status(500).json({ detail: "Failed to fetch Ollama models" });
    }
});
