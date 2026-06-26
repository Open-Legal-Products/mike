import { Router, type Response } from "express";
import { requireAuth } from "../middleware/auth";
import { checkProjectAccess } from "../lib/access";
import { createServerSupabase } from "../lib/supabase";
import {
    coerceMetadata,
    coerceSourceRefs,
    isPlainRecord,
    mapKnowledgeEntry,
    normalizeKnowledgeEntryType,
    sanitizeKnowledgeBody,
    sanitizeKnowledgeTitle,
} from "../lib/knowledge";

export const knowledgeRouter = Router({ mergeParams: true });

type Db = ReturnType<typeof createServerSupabase>;

type KnowledgeEntryRow = {
    id: string;
    user_id: string;
    project_id: string | null;
    [key: string]: unknown;
};

function bad(res: Response, detail: string) {
    return void res.status(400).json({ detail });
}

function normalizeCreatePayload(body: unknown) {
    if (!isPlainRecord(body)) return { ok: false as const, detail: "Invalid body" };
    const entryType = normalizeKnowledgeEntryType(body.entry_type);
    const title = sanitizeKnowledgeTitle(body.title);
    const entryBody = sanitizeKnowledgeBody(body.body);
    if (!entryType) return { ok: false as const, detail: "Invalid entry_type" };
    if (!title) return { ok: false as const, detail: "title is required" };
    if (!entryBody) return { ok: false as const, detail: "body is required" };
    return {
        ok: true as const,
        values: {
            entry_type: entryType,
            title,
            body: entryBody,
            metadata: coerceMetadata(body.metadata),
            source_refs: coerceSourceRefs(body.source_refs),
            include_in_agent_context: body.include_in_agent_context !== false,
        },
    };
}

function normalizePatchPayload(body: unknown) {
    if (!isPlainRecord(body)) return { ok: false as const, detail: "Invalid body" };
    const updates: Record<string, unknown> = {};
    if ("entry_type" in body) {
        const entryType = normalizeKnowledgeEntryType(body.entry_type);
        if (!entryType) return { ok: false as const, detail: "Invalid entry_type" };
        updates.entry_type = entryType;
    }
    if ("title" in body) {
        const title = sanitizeKnowledgeTitle(body.title);
        if (!title) return { ok: false as const, detail: "title is required" };
        updates.title = title;
    }
    if ("body" in body) {
        const entryBody = sanitizeKnowledgeBody(body.body);
        if (!entryBody) return { ok: false as const, detail: "body is required" };
        updates.body = entryBody;
    }
    if ("metadata" in body) updates.metadata = coerceMetadata(body.metadata);
    if ("source_refs" in body) updates.source_refs = coerceSourceRefs(body.source_refs);
    if ("include_in_agent_context" in body) {
        updates.include_in_agent_context = body.include_in_agent_context !== false;
    }
    if ("status" in body) {
        if (body.status !== "active" && body.status !== "archived") {
            return { ok: false as const, detail: "Invalid status" };
        }
        updates.status = body.status;
    }
    updates.updated_at = new Date().toISOString();
    return { ok: true as const, updates };
}

async function canEditEntry(
    db: Db,
    entry: KnowledgeEntryRow,
    userId: string,
    userEmail: string | undefined,
) {
    if (!entry.project_id) return entry.user_id === userId;
    const access = await checkProjectAccess(entry.project_id, userId, userEmail, db);
    if (!access.ok) return false;
    return access.isOwner || entry.user_id === userId;
}

async function getEntry(db: Db, entryId: string) {
    const { data } = await db
        .from("knowledge_entries")
        .select("*")
        .eq("id", entryId)
        .maybeSingle();
    return data as KnowledgeEntryRow | null;
}

// GET /knowledge/library
knowledgeRouter.get("/library", requireAuth, async (_req, res) => {
    const userId = res.locals.userId as string;
    const db = createServerSupabase();
    const { data, error } = await db
        .from("knowledge_entries")
        .select("*")
        .eq("user_id", userId)
        .is("project_id", null)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json(((data ?? []) as Record<string, unknown>[]).map(mapKnowledgeEntry));
});

// POST /knowledge/library
knowledgeRouter.post("/library", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const parsed = normalizeCreatePayload(req.body);
    if (!parsed.ok) return bad(res, parsed.detail);
    const db = createServerSupabase();
    const { data, error } = await db
        .from("knowledge_entries")
        .insert({
            ...parsed.values,
            user_id: userId,
            project_id: null,
            library_origin_id: null,
            status: "active",
        })
        .select("*")
        .single();
    if (error || !data)
        return void res.status(500).json({ detail: error?.message ?? "Failed to create entry" });
    res.status(201).json(mapKnowledgeEntry(data as Record<string, unknown>));
});

// GET /projects/:projectId/knowledge
knowledgeRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
    const db = createServerSupabase();
    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });
    const { data, error } = await db
        .from("knowledge_entries")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "active")
        .order("updated_at", { ascending: false });
    if (error) return void res.status(500).json({ detail: error.message });
    res.json(((data ?? []) as Record<string, unknown>[]).map(mapKnowledgeEntry));
});

// POST /projects/:projectId/knowledge
knowledgeRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
    const parsed = normalizeCreatePayload(req.body);
    if (!parsed.ok) return bad(res, parsed.detail);
    const db = createServerSupabase();
    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });
    const { data, error } = await db
        .from("knowledge_entries")
        .insert({
            ...parsed.values,
            user_id: userId,
            project_id: projectId,
            library_origin_id: null,
            status: "active",
        })
        .select("*")
        .single();
    if (error || !data)
        return void res.status(500).json({ detail: error?.message ?? "Failed to create entry" });
    res.status(201).json(mapKnowledgeEntry(data as Record<string, unknown>));
});

// POST /projects/:projectId/knowledge/link-library
knowledgeRouter.post("/link-library", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { projectId } = req.params;
    const entryId = isPlainRecord(req.body) && typeof req.body.entry_id === "string"
        ? req.body.entry_id
        : "";
    if (!entryId) return void res.status(400).json({ detail: "entry_id is required" });
    const db = createServerSupabase();
    const access = await checkProjectAccess(projectId, userId, userEmail, db);
    if (!access.ok) return void res.status(404).json({ detail: "Project not found" });
    const { data: source } = await db
        .from("knowledge_entries")
        .select("*")
        .eq("id", entryId)
        .eq("user_id", userId)
        .is("project_id", null)
        .eq("status", "active")
        .maybeSingle();
    if (!source) return void res.status(404).json({ detail: "Library entry not found" });
    const src = mapKnowledgeEntry(source as Record<string, unknown>);
    const { data, error } = await db
        .from("knowledge_entries")
        .insert({
            user_id: userId,
            project_id: projectId,
            library_origin_id: src.id,
            entry_type: src.entry_type,
            title: src.title,
            body: src.body,
            metadata: src.metadata,
            source_refs: src.source_refs,
            status: "active",
            include_in_agent_context: src.include_in_agent_context,
        })
        .select("*")
        .single();
    if (error || !data)
        return void res.status(500).json({ detail: error?.message ?? "Failed to link entry" });
    res.status(201).json(mapKnowledgeEntry(data as Record<string, unknown>));
});

// PATCH /knowledge/:entryId
knowledgeRouter.patch("/:entryId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { entryId } = req.params;
    const parsed = normalizePatchPayload(req.body);
    if (!parsed.ok) return bad(res, parsed.detail);
    const db = createServerSupabase();
    const entry = await getEntry(db, entryId);
    if (!entry || !(await canEditEntry(db, entry, userId, userEmail))) {
        return void res.status(404).json({ detail: "Knowledge entry not found" });
    }
    const { data, error } = await db
        .from("knowledge_entries")
        .update(parsed.updates)
        .eq("id", entryId)
        .select("*")
        .single();
    if (error || !data)
        return void res.status(500).json({ detail: error?.message ?? "Failed to update entry" });
    res.json(mapKnowledgeEntry(data as Record<string, unknown>));
});

// DELETE /knowledge/:entryId
knowledgeRouter.delete("/:entryId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { entryId } = req.params;
    const db = createServerSupabase();
    const entry = await getEntry(db, entryId);
    if (!entry || !(await canEditEntry(db, entry, userId, userEmail))) {
        return void res.status(404).json({ detail: "Knowledge entry not found" });
    }
    const { error } = await db
        .from("knowledge_entries")
        .update({ status: "archived", updated_at: new Date().toISOString() })
        .eq("id", entryId);
    if (error) return void res.status(500).json({ detail: error.message });
    res.status(204).send();
});
