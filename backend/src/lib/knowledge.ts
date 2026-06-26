import { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

export const KNOWLEDGE_ENTRY_TYPES = [
    "fact",
    "party",
    "date",
    "clause",
    "position",
    "playbook",
    "source",
] as const;

export type KnowledgeEntryType = (typeof KNOWLEDGE_ENTRY_TYPES)[number];
export type KnowledgeEntryStatus = "active" | "archived";

export type KnowledgeEntry = {
    id: string;
    user_id: string;
    project_id: string | null;
    library_origin_id: string | null;
    entry_type: KnowledgeEntryType;
    title: string;
    body: string;
    metadata: Record<string, unknown>;
    source_refs: unknown[];
    status: KnowledgeEntryStatus;
    include_in_agent_context: boolean;
    created_at: string;
    updated_at: string;
};

export type KnowledgeSuggestion = {
    entry_type: KnowledgeEntryType;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
    source_refs?: unknown[];
};

const ENTRY_TYPE_SET = new Set<string>(KNOWLEDGE_ENTRY_TYPES);

export function isKnowledgeEntryType(
    value: unknown,
): value is KnowledgeEntryType {
    return typeof value === "string" && ENTRY_TYPE_SET.has(value);
}

export function normalizeKnowledgeEntryType(
    value: unknown,
): KnowledgeEntryType | null {
    return isKnowledgeEntryType(value) ? value : null;
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

export function coerceMetadata(value: unknown): Record<string, unknown> {
    return isPlainRecord(value) ? value : {};
}

export function coerceSourceRefs(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

export function sanitizeKnowledgeTitle(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

export function sanitizeKnowledgeBody(value: unknown): string {
    return typeof value === "string" ? value.trim().slice(0, 12000) : "";
}

export function mapKnowledgeEntry(row: Record<string, unknown>): KnowledgeEntry {
    return {
        id: String(row.id ?? ""),
        user_id: String(row.user_id ?? ""),
        project_id:
            typeof row.project_id === "string" ? row.project_id : null,
        library_origin_id:
            typeof row.library_origin_id === "string"
                ? row.library_origin_id
                : null,
        entry_type:
            normalizeKnowledgeEntryType(row.entry_type) ?? "fact",
        title: typeof row.title === "string" ? row.title : "",
        body: typeof row.body === "string" ? row.body : "",
        metadata: coerceMetadata(row.metadata),
        source_refs: coerceSourceRefs(row.source_refs),
        status: row.status === "archived" ? "archived" : "active",
        include_in_agent_context: row.include_in_agent_context !== false,
        created_at: typeof row.created_at === "string" ? row.created_at : "",
        updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
    };
}

export function parseKnowledgeSuggestion(value: unknown): KnowledgeSuggestion | null {
    if (!isPlainRecord(value)) return null;
    const entryType = normalizeKnowledgeEntryType(value.entry_type);
    const title = sanitizeKnowledgeTitle(value.title);
    const body = sanitizeKnowledgeBody(value.body);
    if (!entryType || !title || !body) return null;
    return {
        entry_type: entryType,
        title,
        body,
        metadata: coerceMetadata(value.metadata),
        source_refs: coerceSourceRefs(value.source_refs),
    };
}

export async function listProjectKnowledgeContext(
    db: Db,
    projectId: string,
    limit = 20,
): Promise<KnowledgeEntry[]> {
    const { data } = await db
        .from("knowledge_entries")
        .select("*")
        .eq("project_id", projectId)
        .eq("status", "active")
        .eq("include_in_agent_context", true)
        .order("updated_at", { ascending: false })
        .limit(limit);

    return ((data ?? []) as Record<string, unknown>[]).map(mapKnowledgeEntry);
}

export async function listKnowledgeForAgent(args: {
    db: Db;
    userId: string;
    projectId?: string | null;
    scope?: "project" | "library" | "all";
    query?: string | null;
    entryTypes?: KnowledgeEntryType[];
    limit?: number;
}): Promise<KnowledgeEntry[]> {
    const {
        db,
        userId,
        projectId,
        scope = "all",
        query,
        entryTypes,
        limit = 20,
    } = args;
    const shouldLoadProject = !!projectId && scope !== "library";
    const shouldLoadLibrary = scope !== "project";
    const normalizedQuery = query?.trim().toLowerCase() ?? "";
    const types = entryTypes?.length ? new Set(entryTypes) : null;
    const results: KnowledgeEntry[] = [];

    if (shouldLoadProject && projectId) {
        const { data } = await db
            .from("knowledge_entries")
            .select("*")
            .eq("project_id", projectId)
            .eq("status", "active")
            .order("updated_at", { ascending: false })
            .limit(limit);
        results.push(
            ...((data ?? []) as Record<string, unknown>[]).map(mapKnowledgeEntry),
        );
    }

    if (shouldLoadLibrary) {
        const { data } = await db
            .from("knowledge_entries")
            .select("*")
            .eq("user_id", userId)
            .is("project_id", null)
            .eq("status", "active")
            .order("updated_at", { ascending: false })
            .limit(limit);
        results.push(
            ...((data ?? []) as Record<string, unknown>[]).map(mapKnowledgeEntry),
        );
    }

    return results
        .filter((entry) => !types || types.has(entry.entry_type))
        .filter((entry) => {
            if (!normalizedQuery) return true;
            return `${entry.title}\n${entry.body}\n${entry.entry_type}`
                .toLowerCase()
                .includes(normalizedQuery);
        })
        .slice(0, limit);
}

export async function getKnowledgeForAgent(args: {
    db: Db;
    userId: string;
    entryId: string;
    projectId?: string | null;
}): Promise<KnowledgeEntry | null> {
    const { data } = await args.db
        .from("knowledge_entries")
        .select("*")
        .eq("id", args.entryId)
        .eq("status", "active")
        .maybeSingle();
    if (!data) return null;
    const entry = mapKnowledgeEntry(data as Record<string, unknown>);
    if (entry.project_id && entry.project_id === args.projectId) return entry;
    if (!entry.project_id && entry.user_id === args.userId) return entry;
    return null;
}

export function formatKnowledgeDigest(entries: KnowledgeEntry[]): string {
    if (entries.length === 0) return "";
    return entries
        .map((entry, index) => {
            const type = entry.entry_type.toUpperCase();
            const body = entry.body.replace(/\s+/g, " ").trim().slice(0, 900);
            return `${index + 1}. [${type}] ${entry.title}: ${body}`;
        })
        .join("\n");
}

export function knowledgeEntryForTool(entry: KnowledgeEntry) {
    return {
        id: entry.id,
        scope: entry.project_id ? "project" : "library",
        entry_type: entry.entry_type,
        title: entry.title,
        body: entry.body,
        metadata: entry.metadata,
        source_refs: entry.source_refs,
        updated_at: entry.updated_at,
    };
}
