// Review CRUD + overview for the tabular-review module, plus single-cell
// regeneration and cell clearing.

import { downloadFile } from "../../lib/storage";
import {
    attachActiveVersionPaths,
    loadActiveVersion,
} from "../../lib/documentVersions";
import { completeText } from "../../lib/llm";
import { getUserModelSettings } from "../../lib/userSettings";
import {
    checkProjectAccess,
    ensureReviewAccess,
    filterAccessibleDocumentIds,
    resolveContentOrgId,
} from "../../lib/access";
import {
    extractDocumentMarkdown,
    queryTabularCell,
} from "./tabular.extract";
import {
    findMissingUserEmails,
    loadProfileUsersByEmail,
} from "../../lib/userLookup";
import {
    missingModelApiKey,
    parseCellContent,
    type CellResult,
    type Db,
    type Log,
    type MissingApiKey,
} from "./tabular.shared";

// ---------------------------------------------------------------------------
// Review CRUD + overview
// ---------------------------------------------------------------------------

export async function getTabularReviewsOverview(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        projectIdFilter: string | null;
    },
): Promise<{ ok: true; data: unknown } | { ok: false; detail: string }> {
    const { userId, userEmail, projectIdFilter } = args;
    const { data, error } = await db.rpc("get_tabular_reviews_overview", {
        p_user_id: userId,
        p_user_email: userEmail ?? null,
        p_project_id: projectIdFilter,
    });
    if (error) return { ok: false, detail: error.message };
    // MERGE-REVIEW: upstream replaced fork's app-level own/shared/direct-share
    // merge + document_count computation with the get_tabular_reviews_overview
    // RPC (called above). Adopting upstream's RPC approach; sharing/access and
    // doc counts are now resolved server-side in the RPC.
    return { ok: true, data: data ?? [] };
}

export async function createTabularReview(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        title?: string;
        document_ids: string[];
        columns_config: { index: number; name: string; prompt: string }[];
        workflow_id?: string;
        project_id?: string;
    },
): Promise<
    | { ok: true; review: Record<string, unknown> }
    | { ok: false; kind: "project_not_found" }
    | { ok: false; kind: "db_error"; detail: string }
> {
    const {
        userId,
        userEmail,
        title,
        document_ids,
        columns_config,
        workflow_id,
        project_id,
    } = args;

    if (project_id) {
        const access = await checkProjectAccess(
            project_id,
            userId,
            userEmail,
            db,
        );
        if (!access.ok) return { ok: false, kind: "project_not_found" };
    }
    const allowedDocumentIds = Array.isArray(document_ids)
        ? await filterAccessibleDocumentIds(document_ids, userId, userEmail, db)
        : [];
    // Tenant assignment: inherit the project's org when project-scoped,
    // otherwise the caller's personal org.
    const orgId = await resolveContentOrgId(db, {
        userId,
        projectId: project_id ?? null,
    });
    const { data: review, error } = await db
        .from("tabular_reviews")
        .insert({
            user_id: userId,
            title: title ?? null,
            columns_config,
            document_ids: allowedDocumentIds,
            project_id: project_id ?? null,
            workflow_id: workflow_id ?? null,
            org_id: orgId,
        })
        .select("*")
        .single();
    if (error || !review)
        return {
            ok: false,
            kind: "db_error",
            detail: error?.message ?? "Failed to create review",
        };

    const cells = allowedDocumentIds.flatMap((docId) =>
        columns_config.map((col) => ({
            review_id: review.id,
            document_id: docId,
            column_index: col.index,
            status: "pending",
        })),
    );
    if (cells.length) await db.from("tabular_cells").insert(cells);

    return { ok: true, review };
}

export async function generateColumnPrompt(
    args: {
        userId: string;
        title: string;
        format: string;
        documentName: string;
        tags: string[];
    },
): Promise<
    | { ok: true; prompt: string }
    | { ok: false; kind: "empty" }
    | { ok: false; kind: "failed" }
> {
    const { userId, title, format, documentName, tags } = args;

    const formatDescriptions: Record<string, string> = {
        text: "free-form text",
        bulleted_list: "a bulleted list",
        number: "a single number",
        percentage: "a percentage value",
        monetary_amount: "a monetary amount",
        currency: "a currency code",
        yes_no: "Yes or No",
        date: "a date",
        tag: tags.length ? `one of these tags: ${tags.join(", ")}` : "a tag",
    };
    const formatHint = formatDescriptions[format] ?? "free-form text";
    const tagsNote =
        format === "tag" && tags.length
            ? `\nAvailable tags: ${tags.join(", ")}`
            : "";
    const docNote = documentName ? `\nDocument type/name: ${documentName}` : "";

    const userMessage =
        `Column title: ${title}` +
        docNote +
        `\nExpected response format: ${formatHint}` +
        tagsNote +
        `\n\nWrite the best extraction prompt for a legal tabular review column with this title. ` +
        `Do NOT include any instruction about the response format in the prompt — ` +
        `format handling is applied separately and must not be duplicated inside the prompt text.`;

    try {
        const { title_model, api_keys } = await getUserModelSettings(userId);
        const raw = await completeText({
            model: title_model,
            systemPrompt:
                'You write high-quality column prompts for legal tabular review workflows. Return only valid JSON with a single field: {"prompt": string}. The prompt you write must focus solely on what to extract — never on how to format the response.',
            user: userMessage,
            maxTokens: 512,
            apiKeys: api_keys,
        });
        const parsed = JSON.parse(
            raw
                .replace(/^```(?:json)?\n?/i, "")
                .replace(/\n?```$/, "")
                .trim(),
        ) as { prompt?: unknown };
        if (typeof parsed.prompt === "string" && parsed.prompt.trim()) {
            return { ok: true, prompt: parsed.prompt.trim() };
        }
        return { ok: false, kind: "empty" };
    } catch {
        return { ok: false, kind: "failed" };
    }
}

export async function getTabularReviewDetail(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
    const { reviewId, userId, userEmail } = args;

    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (error || !review) return { ok: false };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false };

    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);
    const cellDocIds = [
        ...new Set((cells ?? []).map((c: any) => c.document_id)),
    ];
    const hasExplicitDocIds = Array.isArray(review.document_ids);
    const explicitDocIds = hasExplicitDocIds
        ? (review.document_ids as string[])
        : [];
    const docIds = hasExplicitDocIds ? explicitDocIds : cellDocIds;
    const docsResult =
        docIds.length > 0
            ? await db.from("documents").select("*").in("id", docIds)
            : { data: [] as Record<string, unknown>[] };
    const docs: {
        id: string;
        current_version_id?: string | null;
    }[] = docsResult.data ?? [];
    await attachActiveVersionPaths(db, docs);

    return {
        ok: true,
        body: {
            review: { ...review, is_owner: access.isOwner },
            cells: (cells ?? []).map((cell: any) => ({
                ...cell,
                content: parseCellContent(cell.content),
            })),
            documents: docs,
        },
    };
}

export async function getTabularReviewPeople(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false }> {
    const { reviewId, userId, userEmail } = args;

    const { data: review } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id, shared_with, org_id")
        .eq("id", reviewId)
        .single();
    if (!review) return { ok: false };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false };

    const sharedWith: string[] = (
        Array.isArray(review.shared_with)
            ? (review.shared_with as string[])
            : []
    ).map((e) => (e ?? "").toLowerCase());

    // Use the mirrored profile email so sharing checks do not scan auth.users.
    const { userByEmail, userById } = await loadProfileUsersByEmail(db);

    const ownerInfo = userById.get(review.user_id as string);
    return {
        ok: true,
        body: {
            owner: {
                user_id: review.user_id,
                email: ownerInfo?.email ?? null,
                display_name: ownerInfo?.display_name ?? null,
            },
            members: sharedWith.map((email) => {
                const u = userByEmail.get(email);
                const display_name = u?.display_name ?? null;
                return { email, display_name };
            }),
        },
    };
}

export async function updateTabularReview(
    db: Db,
    args: {
        reviewId: string;
        userId: string;
        userEmail: string | undefined;
        body: Record<string, any>;
    },
): Promise<
    | { ok: true; body: Record<string, unknown> }
    | {
          ok: false;
          kind:
              | "invalid_project_id"
              | "self_share"
              | "not_found"
              | "columns_forbidden"
              | "sharing_forbidden"
              | "move_forbidden"
              | "target_project_not_found";
      }
    | { ok: false; kind: "missing_user"; detail: string }
    | { ok: false; kind: "db_error"; detail: string }
> {
    const { reviewId, userId, userEmail, body } = args;

    const updates: Record<string, unknown> = {};
    if (body.title != null) updates.title = body.title;
    const projectIdUpdateProvided = body.project_id !== undefined;
    const projectIdUpdate =
        body.project_id === null
            ? null
            : typeof body.project_id === "string" && body.project_id.trim()
              ? body.project_id.trim()
              : undefined;
    if (projectIdUpdateProvided && projectIdUpdate === undefined) {
        return { ok: false, kind: "invalid_project_id" };
    }
    // shared_with edits are owner-only — gated below after we know who's
    // making the call. Normalize lowercase + dedupe + drop empties.
    let sharedWithUpdate: string[] | undefined;
    if (Array.isArray(body.shared_with)) {
        const normalizedUserEmail = userEmail?.trim().toLowerCase();
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const raw of body.shared_with) {
            if (typeof raw !== "string") continue;
            const e = raw.trim().toLowerCase();
            if (!e || seen.has(e)) continue;
            if (normalizedUserEmail && e === normalizedUserEmail) {
                return { ok: false, kind: "self_share" };
            }
            seen.add(e);
            cleaned.push(e);
        }
        sharedWithUpdate = cleaned;
    }
    updates.updated_at = new Date().toISOString();

    const { data: existingReview, error: reviewError } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (reviewError || !existingReview) return { ok: false, kind: "not_found" };
    const access = await ensureReviewAccess(
        existingReview,
        userId,
        userEmail,
        db,
    );
    if (!access.ok) return { ok: false, kind: "not_found" };
    if (body.columns_config != null) {
        if (!access.isOwner) return { ok: false, kind: "columns_forbidden" };
        updates.columns_config = body.columns_config;
    }
    if (sharedWithUpdate !== undefined) {
        if (!access.isOwner) return { ok: false, kind: "sharing_forbidden" };
        // Sharing targets must be existing Mike users (mirrored profile emails).
        const missingSharedUsers = await findMissingUserEmails(
            db,
            sharedWithUpdate,
        );
        if (missingSharedUsers.length > 0) {
            return {
                ok: false,
                kind: "missing_user",
                detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
            };
        }
        updates.shared_with = sharedWithUpdate;
    }
    if (projectIdUpdateProvided) {
        if (!access.isOwner) return { ok: false, kind: "move_forbidden" };
        if (projectIdUpdate) {
            const projectAccess = await checkProjectAccess(
                projectIdUpdate,
                userId,
                userEmail,
                db,
            );
            if (!projectAccess.ok)
                return { ok: false, kind: "target_project_not_found" };
        }
        updates.project_id = projectIdUpdate;
    }

    const { data: updatedReview, error: updateError } = await db
        .from("tabular_reviews")
        .update(updates)
        .eq("id", reviewId)
        .select("*")
        .single();
    if (updateError || !updatedReview)
        return {
            ok: false,
            kind: "db_error",
            detail: updateError?.message ?? "Failed to update review",
        };

    let persistedDocumentIds: string[] | undefined;
    if (
        Array.isArray(body.columns_config) ||
        Array.isArray(body.document_ids)
    ) {
        const { data: existingCells } = await db
            .from("tabular_cells")
            .select("document_id,column_index")
            .eq("review_id", reviewId);
        const existingKeys = new Set(
            (existingCells ?? []).map(
                (cell: any) => `${cell.document_id}:${cell.column_index}`,
            ),
        );

        let documentIds: string[];

        if (Array.isArray(body.document_ids)) {
            // document_ids is the new source of truth — delete removed docs' cells
            const requestedDocIds = body.document_ids as string[];
            const existingDocIds = (existingCells ?? []).map(
                (cell: any) => cell.document_id,
            );
            const existingDocIdSet = new Set(existingDocIds);
            const newDocCandidates = requestedDocIds.filter(
                (id) => !existingDocIdSet.has(id),
            );
            const newDocAllowed = await filterAccessibleDocumentIds(
                newDocCandidates,
                userId,
                userEmail,
                db,
            );
            const newDocAllowedSet = new Set(newDocAllowed);
            const newDocIds = requestedDocIds.filter(
                (id) => existingDocIdSet.has(id) || newDocAllowedSet.has(id),
            );
            const removedDocIds = existingDocIds.filter(
                (id: string) => !newDocIds.includes(id),
            );

            if (removedDocIds.length > 0) {
                const { error: deleteError } = await db
                    .from("tabular_cells")
                    .delete()
                    .eq("review_id", reviewId)
                    .in("document_id", removedDocIds);
                if (deleteError)
                    return {
                        ok: false,
                        kind: "db_error",
                        detail: deleteError.message,
                    };
            }

            documentIds = newDocIds;
        } else {
            // No document change — derive from existing cells
            documentIds = [
                ...new Set(
                    (existingCells ?? []).map((cell: any) => cell.document_id),
                ),
            ] as string[];
        }

        if (Array.isArray(body.document_ids)) {
            persistedDocumentIds = documentIds;
            const { error: documentIdsError } = await db
                .from("tabular_reviews")
                .update({
                    document_ids: documentIds,
                    updated_at: new Date().toISOString(),
                })
                .eq("id", reviewId);
            if (documentIdsError)
                return {
                    ok: false,
                    kind: "db_error",
                    detail: documentIdsError.message,
                };
        }

        const activeColumns = Array.isArray(body.columns_config)
            ? body.columns_config
            : (updatedReview.columns_config ?? []);
        const newCells = documentIds.flatMap((documentId) =>
            activeColumns
                .filter(
                    (column: { index: number }) =>
                        !existingKeys.has(`${documentId}:${column.index}`),
                )
                .map((column: { index: number }) => ({
                    review_id: reviewId,
                    document_id: documentId,
                    column_index: column.index,
                    status: "pending",
                })),
        );

        if (newCells.length > 0) {
            const { error: insertError } = await db
                .from("tabular_cells")
                .insert(newCells);
            if (insertError)
                return {
                    ok: false,
                    kind: "db_error",
                    detail: insertError.message,
                };
        }
    }

    return {
        ok: true,
        body: {
            ...updatedReview,
            ...(persistedDocumentIds
                ? { document_ids: persistedDocumentIds }
                : {}),
        },
    };
}

export async function deleteTabularReview(
    db: Db,
    args: { reviewId: string; userId: string },
): Promise<{ ok: true } | { ok: false; detail: string }> {
    const { reviewId, userId } = args;
    const { error } = await db
        .from("tabular_reviews")
        .delete()
        .eq("id", reviewId)
        .eq("user_id", userId);
    if (error) return { ok: false, detail: error.message };
    return { ok: true };
}

export async function clearTabularCells(
    db: Db,
    args: {
        reviewId: string;
        userId: string;
        userEmail: string | undefined;
        document_ids: string[];
    },
): Promise<
    | { ok: true }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "db_error"; detail: string }
> {
    const { reviewId, userId, userEmail, document_ids } = args;

    const { data: review, error: reviewError } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id, org_id")
        .eq("id", reviewId)
        .single();
    if (reviewError || !review) return { ok: false, kind: "not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "not_found" };

    const { error } = await db
        .from("tabular_cells")
        .update({ content: null, status: "pending" })
        .eq("review_id", reviewId)
        .in("document_id", document_ids);
    if (error) return { ok: false, kind: "db_error", detail: error.message };
    return { ok: true };
}

export async function regenerateTabularCell(
    db: Db,
    args: {
        reviewId: string;
        userId: string;
        userEmail: string | undefined;
        document_id: string;
        column_index: number;
    },
    log: Log,
): Promise<
    | { ok: true; result: CellResult }
    | { ok: false; kind: "review_not_found" }
    | { ok: false; kind: "column_not_found" }
    | { ok: false; kind: "document_not_found" }
    | { ok: false; kind: "missing_api_key"; missingKey: MissingApiKey }
    | { ok: false; kind: "generation_failed" }
> {
    const { reviewId, userId, userEmail, document_id, column_index } = args;

    const { data: review, error: reviewError } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (reviewError || !review) return { ok: false, kind: "review_not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "review_not_found" };

    const column = (
        review.columns_config as {
            index: number;
            name: string;
            prompt: string;
            format?: string;
            tags?: string[];
        }[]
    ).find((c) => c.index === column_index);
    if (!column) return { ok: false, kind: "column_not_found" };

    const docAllowed = await filterAccessibleDocumentIds(
        [document_id],
        userId,
        userEmail,
        db,
    );
    if (docAllowed.length === 0)
        return { ok: false, kind: "document_not_found" };
    const { data: doc } = await db
        .from("documents")
        .select("id, current_version_id")
        .eq("id", document_id)
        .single();
    if (!doc) return { ok: false, kind: "document_not_found" };
    const docActive = await loadActiveVersion(document_id, db);

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) return { ok: false, kind: "missing_api_key", missingKey };

    await db
        .from("tabular_cells")
        .update({ status: "generating", content: null })
        .eq("review_id", reviewId)
        .eq("document_id", document_id)
        .eq("column_index", column_index);

    let markdown = "";
    if (docActive) {
        const buf = await downloadFile(docActive.storage_path);
        if (buf) {
            try {
                markdown = await extractDocumentMarkdown(
                    buf,
                    docActive.file_type,
                );
            } catch (err) {
                log.error(
                    { err, document_id },
                    "[regenerate-cell] extraction error",
                );
            }
        }
    }

    const result = await queryTabularCell(
        tabular_model,
        docActive?.filename?.trim() || "Untitled document",
        markdown,
        column.prompt,
        column.format,
        column.tags,
        api_keys,
    );

    if (!result) {
        await db
            .from("tabular_cells")
            .update({ status: "error" })
            .eq("review_id", reviewId)
            .eq("document_id", document_id)
            .eq("column_index", column_index);
        return { ok: false, kind: "generation_failed" };
    }

    await db
        .from("tabular_cells")
        .update({ content: JSON.stringify(result), status: "done" })
        .eq("review_id", reviewId)
        .eq("document_id", document_id)
        .eq("column_index", column_index);

    return { ok: true, result };
}
