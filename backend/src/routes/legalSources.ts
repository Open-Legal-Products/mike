import { Router, type Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth";
import {
    ONTARIO_COURT_FORMS,
    ONTARIO_PROCEDURE_SOURCES,
    calculateOntarioDeadline,
    createLegalSourceRegistry,
    parseCanadianCitations,
    renderCanadianCitation,
    verifyCanadianCitations,
} from "../lib/legalSources";
import { createServerSupabase } from "../lib/supabase";
import { getUserModelSettings } from "../lib/userSettings";

export const legalSourcesRouter = Router();
const registry = createLegalSourceRegistry();

const searchSchema = z.object({
    providerId: z.string().min(1).default("a2aj-canada"),
    query: z.string().trim().min(2).max(500),
    court: z.string().trim().max(100).optional(),
    jurisdiction: z.enum(["CA", "CA-ON", "US"]).optional(),
    language: z.enum(["en", "fr"]).optional(),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
    offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

const citationSchema = z.object({
    providerId: z.string().min(1).default("a2aj-canada"),
    citations: z.array(z.string().trim().min(2).max(250)).min(1).max(20),
});

const legislationSearchSchema = z.object({
    providerId: z.string().min(1).optional(),
    query: z.string().trim().min(2).max(500),
    jurisdiction: z.enum(["CA", "CA-ON"]).optional(),
    language: z.enum(["en", "fr"]).default("en"),
    kind: z.enum(["legislation", "regulation", "rule"]).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(10),
});

const canadianCitationSchema = z.object({
    text: z.string().trim().min(2).max(20_000),
    profile: z.enum(["onca", "mcgill-compatible"]).default("onca"),
});

const ontarioDeadlineSchema = z.object({
    profile: z.enum(["ontario-civil-rule-3", "ontario-small-claims-rule-3"]),
    triggerDate: z.string().date(),
    days: z.number().int().min(1).max(366),
    serviceLocalTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
    originatingProcess: z.boolean().optional(),
    additionalHolidays: z.array(z.string().date()).max(50).optional(),
    courtClosures: z.array(z.string().date()).max(50).optional(),
});

legalSourcesRouter.use(requireAuth);

legalSourcesRouter.get("/procedure/sources", (_req, res) => {
    res.json({
        jurisdiction: "CA-ON",
        sources: ONTARIO_PROCEDURE_SOURCES,
        warning:
            "Confirm the current official rule and the applicable court region before relying on a procedure source.",
    });
});

legalSourcesRouter.get("/procedure/forms", (_req, res) => {
    res.json({
        jurisdiction: "CA-ON",
        forms: ONTARIO_COURT_FORMS,
        warning:
            "ROSS links to official catalogues and does not retain form copies. Confirm the current official version before filing.",
    });
});

legalSourcesRouter.post("/procedure/deadlines/calculate", (req, res) => {
    const parsed = ontarioDeadlineSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({
            error: "Invalid Ontario deadline calculation request.",
            issues: parsed.error.issues,
        });
    try {
        return res.json({ calculation: calculateOntarioDeadline(parsed.data) });
    } catch (error) {
        const message =
            error instanceof Error
                ? error.message
                : "Ontario deadline calculation failed.";
        return res.status(400).json({ error: message });
    }
});

legalSourcesRouter.get("/status", async (_req, res) => {
    const userId = String(res.locals.userId ?? "");
    const settings = await getUserModelSettings(userId);
    const providers = await Promise.all(
        registry.list().map(async (provider) => ({
            ...provider.descriptor,
            health: await provider.health({
                apiToken:
                    provider.descriptor.id === "courtlistener-us"
                        ? settings.api_keys.courtlistener
                        : null,
            }),
        })),
    );
    res.json({ providers });
});

legalSourcesRouter.get("/coverage", async (_req, res) => {
    const providers = await Promise.all(
        registry.list().map(async (provider) => ({
            provider: provider.descriptor,
            coverage: provider.coverage ? await provider.coverage() : [],
        })),
    );
    const a2ajDatasets = new Set(
        providers.flatMap((entry) =>
            entry.provider.id === "a2aj-canada"
                ? entry.coverage.map((row) => row.dataset)
                : [],
        ),
    );
    res.json({
        providers,
        knownOntarioGaps: [
            { dataset: "ONSC", label: "Ontario Superior Court of Justice" },
            { dataset: "ONCJ", label: "Ontario Court of Justice" },
            { dataset: "HRTO", label: "Human Rights Tribunal of Ontario" },
            { dataset: "ONLTB", label: "Landlord and Tenant Board" },
        ].filter(({ dataset }) => !a2ajDatasets.has(dataset)),
        warning:
            "Coverage is provider-reported and may change. Unlisted courts and tribunals are not represented as covered.",
    });
});

legalSourcesRouter.get("/decisions/search", async (req, res) => {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success)
        return res.status(400).json({
            error: "Invalid legal-source search.",
            issues: parsed.error.issues,
        });
    try {
        const provider = registry.get(parsed.data.providerId);
        if (!provider.searchDecisions)
            return res
                .status(501)
                .json({ error: "This provider cannot search decisions." });
        const results = await provider.searchDecisions(
            parsed.data,
            await providerContext(res, provider.descriptor.id),
        );
        return res.json({
            provider: provider.descriptor,
            results,
            offset: parsed.data.offset,
            limit: parsed.data.limit,
        });
    } catch (error) {
        return legalSourceError(res, error);
    }
});

legalSourcesRouter.get("/decisions/:providerId/:sourceId", async (req, res) => {
    try {
        const provider = registry.get(req.params.providerId);
        if (!provider.fetchDecision)
            return res
                .status(501)
                .json({ error: "This provider cannot fetch decisions." });
        const document = await provider.fetchDecision(
            req.params.sourceId,
            await providerContext(res, provider.descriptor.id),
        );
        return res.json({ provider: provider.descriptor, document });
    } catch (error) {
        return legalSourceError(res, error);
    }
});

legalSourcesRouter.get(
    "/decisions/:providerId/:sourceId/passages",
    async (req, res) => {
        const query =
            typeof req.query.query === "string" ? req.query.query.trim() : "";
        const limit = Math.min(10, Math.max(1, Number(req.query.limit) || 5));
        if (query.length < 2 || query.length > 500)
            return res.status(400).json({
                error: "A passage query between 2 and 500 characters is required.",
            });
        try {
            const provider = registry.get(req.params.providerId);
            if (!provider.fetchDecision)
                return res
                    .status(501)
                    .json({ error: "This provider cannot fetch decisions." });
            const document = await provider.fetchDecision(
                req.params.sourceId,
                await providerContext(res, provider.descriptor.id),
            );
            const passages =
                provider.findPassages?.(document, query, limit) ?? [];
            return res.json({
                provider: provider.descriptor,
                sourceId: document.sourceId,
                query,
                passages,
            });
        } catch (error) {
            return legalSourceError(res, error);
        }
    },
);

legalSourcesRouter.post("/citations/verify", async (req, res) => {
    const parsed = citationSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({
            error: "Invalid citation verification request.",
            issues: parsed.error.issues,
        });
    try {
        const provider = registry.get(parsed.data.providerId);
        if (!provider.verifyCitations)
            return res
                .status(501)
                .json({ error: "This provider cannot verify citations." });
        const results = await provider.verifyCitations(
            parsed.data.citations,
            await providerContext(res, provider.descriptor.id),
        );
        return res.json({ provider: provider.descriptor, results });
    } catch (error) {
        return legalSourceError(res, error);
    }
});

legalSourcesRouter.post("/citations/canadian/parse", async (req, res) => {
    const parsed = canadianCitationSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({
            error: "Invalid Canadian citation text.",
            issues: parsed.error.issues,
        });
    const citations = parseCanadianCitations(parsed.data.text);
    return res.json({
        profile: parsed.data.profile,
        citations: citations.map((citation) => ({
            ...citation,
            rendered: renderCanadianCitation(citation, {
                profile: parsed.data.profile,
            }),
        })),
    });
});

legalSourcesRouter.post("/citations/canadian/verify", async (req, res) => {
    const parsed = canadianCitationSchema.safeParse(req.body);
    if (!parsed.success)
        return res.status(400).json({
            error: "Invalid Canadian citation text.",
            issues: parsed.error.issues,
        });
    const citations = parseCanadianCitations(parsed.data.text);
    const results = await verifyCanadianCitations(citations, registry.list());
    return res.json({
        profile: parsed.data.profile,
        results,
        warning:
            "Parsing is not verification. A citation is upgraded only after an authorized provider returns a matching source.",
    });
});

legalSourcesRouter.get("/legislation/search", async (req, res) => {
    const parsed = legislationSearchSchema.safeParse(req.query);
    if (!parsed.success)
        return res.status(400).json({
            error: "Invalid legislation search.",
            issues: parsed.error.issues,
        });
    try {
        const providers = parsed.data.providerId
            ? [registry.get(parsed.data.providerId)]
            : registry
                  .list({
                      jurisdiction: parsed.data.jurisdiction,
                  })
                  .filter((provider) => provider.searchLegislation);
        const results = (
            await Promise.all(
                providers.map(async (provider) =>
                    provider.searchLegislation
                        ? provider.searchLegislation(parsed.data)
                        : [],
                ),
            )
        )
            .flat()
            .slice(0, parsed.data.limit);
        return res.json({
            providers: providers.map((provider) => provider.descriptor),
            results,
        });
    } catch (error) {
        return legalSourceError(res, error);
    }
});

legalSourcesRouter.get(
    "/legislation/:providerId/:sourceId",
    async (req, res) => {
        const language = req.query.language === "fr" ? "fr" : "en";
        const section =
            typeof req.query.section === "string"
                ? req.query.section.trim()
                : undefined;
        const versionDate =
            typeof req.query.versionDate === "string"
                ? req.query.versionDate.trim()
                : undefined;
        try {
            const provider = registry.get(req.params.providerId);
            if (!provider.fetchLegislation)
                return res.status(501).json({
                    error: "This provider cannot fetch legislation.",
                });
            const document = await provider.fetchLegislation(
                req.params.sourceId,
                {
                    language,
                    section,
                    versionDate,
                },
            );
            return res.json({ provider: provider.descriptor, document });
        } catch (error) {
            return legalSourceError(res, error);
        }
    },
);

async function providerContext(res: Response, providerId: string) {
    if (providerId !== "courtlistener-us") return undefined;
    const settings = await getUserModelSettings(
        String(res.locals.userId ?? ""),
    );
    return {
        apiToken: settings.api_keys.courtlistener,
        db: createServerSupabase(),
    };
}

function legalSourceError(res: Response, error: unknown) {
    const message =
        error instanceof Error ? error.message : "Legal source request failed.";
    const status = message.startsWith("Unknown legal source provider")
        ? 404
        : 502;
    return res.status(status).json({ error: message });
}
