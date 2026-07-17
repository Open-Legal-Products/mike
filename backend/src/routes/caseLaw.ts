import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { createLegalSourceRegistry } from "../lib/legalSources";
import { createServerSupabase } from "../lib/supabase";
import { getUserModelSettings } from "../lib/userSettings";

export const caseLawRouter = Router();

caseLawRouter.use(requireAuth);

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

const sidepanelOpinionFetches = new Map<string, Promise<unknown>>();
const legalSources = createLegalSourceRegistry();

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
        devLog("[case-law/case-opinions] loading sidepanel opinions", {
            clusterId,
        });
        const db = createServerSupabase();
        const fetchKey = `${userId}:${clusterId}`;
        let fetchPromise = sidepanelOpinionFetches.get(fetchKey);
        if (fetchPromise) {
            devLog("[case-law/case-opinions] joining in-flight fetch", {
                clusterId,
            });
        } else {
            const courtListener = legalSources.get("courtlistener-us");
            if (!courtListener.fetchDecision)
                throw new Error(
                    "CourtListener decision retrieval is unavailable.",
                );
            fetchPromise = courtListener
                .fetchDecision(String(clusterId), {
                    db,
                    apiToken: settings.api_keys.courtlistener,
                })
                .finally(() => {
                    sidepanelOpinionFetches.delete(fetchKey);
                });
            sidepanelOpinionFetches.set(fetchKey, fetchPromise);
        }
        const fetched = await fetchPromise;
        const decisionRecord =
            fetched && typeof fetched === "object" && !Array.isArray(fetched)
                ? (fetched as Record<string, unknown>)
                : {};
        const fetchedRecord =
            decisionRecord.providerPayload &&
            typeof decisionRecord.providerPayload === "object" &&
            !Array.isArray(decisionRecord.providerPayload)
                ? (decisionRecord.providerPayload as Record<string, unknown>)
                : {};
        const opinions = Array.isArray(fetchedRecord.opinions)
            ? fetchedRecord.opinions
            : [];
        devLog("[case-law/case-opinions] returning sidepanel opinions", {
            clusterId,
            opinionCount: opinions.length,
        });

        return res.json({ opinions });
    } catch (err) {
        const message =
            err instanceof Error
                ? err.message
                : "Failed to fetch case opinions";
        return res.status(502).json({ detail: message });
    }
});
