import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { getCourtlistenerCaseOpinions } from "../../lib/courtlistener";
import { createServerSupabase } from "../../lib/supabase";
import { getUserModelSettings } from "../../lib/userSettings";
import { logger } from "../../lib/logger";

export const caseLawRouter = Router();

caseLawRouter.use(requireAuth);

const sidepanelOpinionFetches = new Map<string, Promise<unknown>>();

function cleanClusterId(value: unknown): number | null {
    const numeric =
        typeof value === "number"
            ? value
            : typeof value === "string"
              ? Number.parseInt(value, 10)
              : NaN;
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
}

caseLawRouter.post("/case-opinions", async (req, res) => {
    const body =
        req.body && typeof req.body === "object" && !Array.isArray(req.body)
            ? (req.body as Record<string, unknown>)
            : {};
    const clusterId = cleanClusterId(body.clusterId ?? body.cluster_id);
    if (!clusterId) {
        return res.status(400).json({
            detail: "cluster_id is required",
        });
    }

    try {
        const userId = String(res.locals.userId ?? "");
        const settings = await getUserModelSettings(userId);
        logger.debug({ clusterId }, "[case-law/case-opinions] loading sidepanel opinions");
        const db = createServerSupabase();
        const fetchKey = `${userId}:${clusterId}`;
        let fetchPromise = sidepanelOpinionFetches.get(fetchKey);
        if (fetchPromise) {
            logger.debug({ clusterId }, "[case-law/case-opinions] joining in-flight fetch");
        } else {
            fetchPromise = getCourtlistenerCaseOpinions({
                clusterId,
                db,
                includeFullText: true,
                maxChars: 50000,
                apiToken: settings.api_keys.courtlistener,
            }).finally(() => {
                sidepanelOpinionFetches.delete(fetchKey);
            });
            sidepanelOpinionFetches.set(fetchKey, fetchPromise);
        }
        const fetched = await fetchPromise;
        const fetchedRecord =
            fetched && typeof fetched === "object" && !Array.isArray(fetched)
                ? (fetched as Record<string, unknown>)
                : {};
        const opinions = Array.isArray(fetchedRecord.opinions)
            ? fetchedRecord.opinions
            : [];
        logger.debug(
            { clusterId, opinionCount: opinions.length },
            "[case-law/case-opinions] returning sidepanel opinions",
        );

        return res.json({ opinions });
    } catch (err) {
        const message =
            err instanceof Error ? err.message : "Failed to fetch case opinions";
        return res.status(502).json({ detail: message });
    }
});
