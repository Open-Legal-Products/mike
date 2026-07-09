import { createServerSupabase } from "./supabase";

type Db = ReturnType<typeof createServerSupabase>;

const PAGE_SIZE = 1000;

function nowStamp() {
    return new Date().toISOString().replace(/[:.]/g, "-");
}

export function userExportFilename(
    kind: "account" | "chats" | "tabular-reviews",
    userId: string,
) {
    return `mike-${kind}-export-${userId.slice(0, 8)}-${nowStamp()}.json`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
    return [...new Set(values.filter((value): value is string => !!value))];
}

async function throwIfError<T extends { message?: string } | null>(
    error: T,
    context: string,
) {
    if (error) throw new Error(`${context}: ${error.message ?? "unknown error"}`);
}

async function selectAll(
    db: Db,
    table: string,
    configure: (query: any) => any,
    columns = "*",
): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
        const to = from + PAGE_SIZE - 1;
        const query = configure(
            (db as any)
                .from(table)
                .select(columns)
                .range(from, to),
        );
        const { data, error } = await query;
        await throwIfError(error, `Failed to export ${table}`);
        const batch = (data ?? []) as Record<string, unknown>[];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) break;
    }

    return rows;
}

async function selectByIds(
    db: Db,
    table: string,
    column: string,
    ids: string[],
): Promise<Record<string, unknown>[]> {
    if (ids.length === 0) return [];
    return selectAll(db, table, (query) => query.in(column, ids));
}

function idsFrom(rows: Record<string, unknown>[], column = "id"): string[] {
    return uniqueStrings(
        rows.map((row) =>
            typeof row[column] === "string" ? (row[column] as string) : null,
        ),
    );
}

async function loadUserChats(db: Db, userId: string) {
    const chats = await selectAll(db, "chats", (query) =>
        query.eq("user_id", userId).order("created_at", { ascending: true }),
    );
    const chatIds = idsFrom(chats);
    const messages = await selectByIds(db, "chat_messages", "chat_id", chatIds);
    return { chats, messages };
}

async function loadUserTabularChats(db: Db, userId: string) {
    const chats = await selectAll(db, "tabular_review_chats", (query) =>
        query.eq("user_id", userId).order("created_at", { ascending: true }),
    );
    const chatIds = idsFrom(chats);
    const messages = await selectByIds(
        db,
        "tabular_review_chat_messages",
        "chat_id",
        chatIds,
    );
    return { chats, messages };
}

async function loadApiKeyStatus(db: Db, userId: string) {
    const rows = await selectAll(db, "user_api_keys", (query) =>
        query
            .eq("user_id", userId)
            .order("provider", { ascending: true }),
        "provider, created_at, updated_at",
    );
    return rows.map((row) => ({
        provider: row.provider,
        has_key: true,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }));
}

export async function buildUserChatsExport(
    db: Db,
    userId: string,
    userEmail?: string | null,
) {
    const [assistant, tabular] = await Promise.all([
        loadUserChats(db, userId),
        loadUserTabularChats(db, userId),
    ]);

    return {
        exported_at: new Date().toISOString(),
        user: { id: userId, email: userEmail ?? null },
        assistant_chats: assistant,
        tabular_review_chats: tabular,
    };
}

export async function buildUserTabularReviewsExport(
    db: Db,
    userId: string,
    userEmail?: string | null,
) {
    const tabularReviews = await selectAll(db, "tabular_reviews", (query) =>
        query.eq("user_id", userId).order("created_at", { ascending: true }),
    );
    const reviewIds = idsFrom(tabularReviews);

    const [cells, chats] = await Promise.all([
        selectByIds(db, "tabular_cells", "review_id", reviewIds),
        selectByIds(db, "tabular_review_chats", "review_id", reviewIds),
    ]);
    const chatIds = idsFrom(chats);
    const messages = await selectByIds(
        db,
        "tabular_review_chat_messages",
        "chat_id",
        chatIds,
    );

    return {
        exported_at: new Date().toISOString(),
        user: { id: userId, email: userEmail ?? null },
        tabular_reviews: tabularReviews,
        tabular_cells: cells,
        tabular_review_chats: {
            chats,
            messages,
        },
    };
}

export async function buildUserAccountExport(
    db: Db,
    userId: string,
    userEmail?: string | null,
) {
    const [
        profile,
        apiKeys,
        projects,
        standaloneDocuments,
        workflows,
        workflowOpenSourceSubmissions,
        hiddenWorkflows,
        workflowSharesByUser,
        workflowSharesWithUser,
        assistantChats,
        tabularChats,
        tabularReviews,
        sharedProjects,
        sharedTabularReviews,
    ] = await Promise.all([
        selectAll(db, "user_profiles", (query) => query.eq("user_id", userId)),
        loadApiKeyStatus(db, userId),
        selectAll(db, "projects", (query) =>
            query.eq("user_id", userId).order("created_at", { ascending: true }),
        ),
        selectAll(db, "documents", (query) =>
            query
                .eq("user_id", userId)
                .is("project_id", null)
                .order("created_at", { ascending: true }),
        ),
        selectAll(db, "workflows", (query) =>
            query.eq("user_id", userId).order("created_at", { ascending: true }),
        ),
        selectAll(db, "workflow_open_source_submissions", (query) =>
            query
                .eq("submitted_by_user_id", userId)
                .order("submitted_at", { ascending: true }),
        ),
        selectAll(db, "hidden_workflows", (query) =>
            query.eq("user_id", userId).order("created_at", { ascending: true }),
        ),
        selectAll(db, "workflow_shares", (query) =>
            query
                .eq("shared_by_user_id", userId)
                .order("created_at", { ascending: true }),
        ),
        userEmail
            ? selectAll(db, "workflow_shares", (query) =>
                  query
                      .eq("shared_with_email", userEmail)
                      .order("created_at", { ascending: true }),
              )
            : Promise.resolve([]),
        loadUserChats(db, userId),
        loadUserTabularChats(db, userId),
        selectAll(db, "tabular_reviews", (query) =>
            query.eq("user_id", userId).order("created_at", { ascending: true }),
        ),
        userEmail
            ? selectAll(db, "projects", (query) =>
                  query
                      .filter("shared_with", "cs", JSON.stringify([userEmail]))
                      .neq("user_id", userId)
                      .order("created_at", { ascending: true }),
                  "id, user_id, name, cm_number, created_at, updated_at",
              )
            : Promise.resolve([]),
        userEmail
            ? selectAll(db, "tabular_reviews", (query) =>
                  query
                      .filter("shared_with", "cs", JSON.stringify([userEmail]))
                      .neq("user_id", userId)
                      .order("created_at", { ascending: true }),
                  "id, user_id, project_id, title, practice, created_at, updated_at",
              )
            : Promise.resolve([]),
    ]);

    const projectIds = idsFrom(projects);
    const projectDocuments = await selectByIds(
        db,
        "documents",
        "project_id",
        projectIds,
    );
    const documents = [...standaloneDocuments, ...projectDocuments];
    const documentIds = idsFrom(documents);
    const reviewIds = idsFrom(tabularReviews);

    const [folders, versions, edits, tabularCells] = await Promise.all([
        selectByIds(db, "project_subfolders", "project_id", projectIds),
        selectByIds(db, "document_versions", "document_id", documentIds),
        selectByIds(db, "document_edits", "document_id", documentIds),
        selectByIds(db, "tabular_cells", "review_id", reviewIds),
    ]);

    return {
        exported_at: new Date().toISOString(),
        user: { id: userId, email: userEmail ?? null },
        profile,
        api_keys: apiKeys,
        projects,
        project_subfolders: folders,
        documents,
        document_versions: versions,
        document_edits: edits,
        workflows,
        workflow_open_source_submissions: workflowOpenSourceSubmissions,
        hidden_workflows: hiddenWorkflows,
        workflow_shares_by_user: workflowSharesByUser,
        workflow_shares_with_user: workflowSharesWithUser,
        chats: assistantChats,
        tabular_reviews: tabularReviews,
        tabular_cells: tabularCells,
        tabular_review_chats: tabularChats,
        shared_access: {
            projects: sharedProjects,
            tabular_reviews: sharedTabularReviews,
        },
    };
}
