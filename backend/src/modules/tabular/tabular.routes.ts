// HTTP layer of the tabular-review module. Handlers parse and validate the
// request, delegate to the module's service files, and map typed results onto
// status codes. Streaming endpoints (generate, chat) keep their SSE loops here;
// their non-streaming prepare/persist logic lives in the service files.

import { Router } from "express";
import { requireAuth } from "../../middleware/auth";
import { createServerSupabase } from "../../lib/supabase";
import {
    AssistantStreamError,
    buildCancelledAssistantMessage,
    isAbortError,
    runLLMStream,
    stripTransientAssistantEvents,
    TABULAR_TOOLS,
    type ChatMessage,
    type TabularCellStore,
} from "../../lib/chat";
import { completeText } from "../../lib/llm";
import {
    extractDocumentMarkdown,
    generateChatTitle,
    queryTabularCell,
} from "./tabular.extract";
import {
    missingModelApiKey,
    parseCellContent,
    type Column,
} from "./tabular.shared";
import { extractRowColumns } from "./tabular.extractRow";
import { prepareTabularGenerate } from "./tabular.generate";
import {
    awaitCellTerminal,
    streamTabularGenerateAsync,
    streamTabularRunView,
} from "./tabular.generateStream";
import { enqueueExtraction } from "../../lib/queue/extractionQueue";
import { loadReviewRows, loadRowDocumentText } from "./tabular.rows";
import {
    createRowsForReview,
    normalizeGrouping,
    rebuildRowsForReview,
    syncCellsForReviewRows,
    type DocumentGrouping,
} from "./tabular.reviews";
import {
    buildTabularMessages,
    extractTabularAnnotations,
} from "./tabular.chats";
import { getUserModelSettings } from "../../lib/userSettings";
import {
    checkProjectAccess,
    ensureReviewAccess,
    filterAccessibleDocumentIds,
} from "../../lib/access";
import { safeErrorLog, safeErrorMessage } from "../../lib/safeError";
import {
    findMissingUserEmails,
    loadProfileUsersByEmail,
} from "../../lib/userLookup";
import { parsePaginationQuery } from "../../lib/pagination";
import { normalizeSearchTerm } from "../../lib/search";
import { parseTabularReviewSort } from "../../lib/sort";
import {
    buildTabularReviewIdsOverviewRpcArgs,
    buildTabularReviewsOverviewRpcArgs,
    parseTabularReviewScope,
} from "../../lib/tabularReviewsOverview";
import { attachActiveVersionPaths } from "../../lib/documentVersions";

export const tabularRouter = Router();

// GET /tabular-review
tabularRouter.get("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();

    const projectIdFilter =
        typeof req.query.project_id === "string" && req.query.project_id
            ? (req.query.project_id as string)
            : null;
    const pagination = parsePaginationQuery(req.query as Record<string, unknown>);
    const searchTerm = normalizeSearchTerm(req.query.search);
    const sort = parseTabularReviewSort(req.query as Record<string, unknown>);
    const scope = parseTabularReviewScope(req.query.scope);

    const rpcArgs = buildTabularReviewsOverviewRpcArgs({
        userId,
        userEmail,
        projectIdFilter,
        scope,
        pagination,
        searchTerm,
        sort,
    });

    const { data, error } = await db.rpc("get_tabular_reviews_overview", rpcArgs);
    if (error) return void res.status(500).json({ detail: error.message });

    res.json(data ?? []);
});

// GET /tabular-review/ids (must come before /:reviewId routes)
// Lightweight id + owner list for every review matching the current
// filters — backs "select all matching" bulk actions so the client doesn't
// have to page through full review payloads just to collect checkboxes.
//
// PostgREST enforces its own row cap on every RPC response (db-max-rows),
// independent of anything this route asks for, and truncates silently
// (206 + a shorter array, no error) rather than failing. So this pages
// through the RPC itself — server-side, same-datacenter round trips — until
// a page comes back empty, rather than trusting one call to return
// everything.
const TABULAR_REVIEW_IDS_PAGE_SIZE = 1000;
const TABULAR_REVIEW_IDS_MAX_PAGES = 200; // guards a runaway loop, not a product limit

tabularRouter.get("/ids", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const db = createServerSupabase();

    const projectIdFilter =
        typeof req.query.project_id === "string" && req.query.project_id
            ? (req.query.project_id as string)
            : null;
    const searchTerm = normalizeSearchTerm(req.query.search);
    const scope = parseTabularReviewScope(req.query.scope);

    const ids: { id: string; user_id: string }[] = [];
    let offset = 0;
    for (let page = 0; page < TABULAR_REVIEW_IDS_MAX_PAGES; page++) {
        const rpcArgs = buildTabularReviewIdsOverviewRpcArgs({
            userId,
            userEmail,
            projectIdFilter,
            scope,
            searchTerm,
            pagination: { limit: TABULAR_REVIEW_IDS_PAGE_SIZE, offset },
        });
        const { data, error } = await db.rpc(
            "get_tabular_review_ids_overview",
            rpcArgs,
        );
        if (error) return void res.status(500).json({ detail: error.message });

        const rows = (data ?? []) as { id: string; user_id: string }[];
        if (rows.length === 0) break;
        ids.push(...rows);
        // Advance by what actually came back, not the requested page size —
        // if PostgREST's cap is lower than TABULAR_REVIEW_IDS_PAGE_SIZE this
        // still converges correctly instead of skipping rows.
        offset += rows.length;
    }

    res.json(ids);
});

// POST /tabular-review
tabularRouter.post("/", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const {
        title,
        document_ids,
        columns_config,
        workflow_id,
        project_id,
        document_grouping,
    } = req.body as {
        title?: string;
        document_ids: string[];
        columns_config: { index: number; name: string; prompt: string }[];
        workflow_id?: string;
        project_id?: string;
        document_grouping?: DocumentGrouping;
    };

    const db = createServerSupabase();
    if (project_id) {
        const access = await checkProjectAccess(
            project_id,
            userId,
            userEmail,
            db,
        );
        if (!access.ok)
            return void res.status(404).json({ detail: "Project not found" });
    }
    const allowedDocumentIds = Array.isArray(document_ids)
        ? await filterAccessibleDocumentIds(document_ids, userId, userEmail, db)
        : [];
    const grouping = normalizeGrouping(document_grouping);
    const { data: review, error } = await db
        .from("tabular_reviews")
        .insert({
            user_id: userId,
            title: title ?? null,
            columns_config,
            document_ids: allowedDocumentIds,
            project_id: project_id ?? null,
            workflow_id: workflow_id ?? null,
            document_grouping: grouping,
        })
        .select("*")
        .single();
    if (error || !review)
        return void res
            .status(500)
            .json({ detail: error?.message ?? "Failed to create review" });

    try {
        await createRowsForReview(
            db,
            review.id,
            userId,
            allowedDocumentIds,
            columns_config,
            grouping,
        );
    } catch (error) {
        await db.from("tabular_reviews").delete().eq("id", review.id);
        return void res.status(500).json({
            detail:
                error instanceof Error
                    ? error.message
                    : "Failed to create review rows",
        });
    }

    res.status(201).json(review);
});

// POST /tabular-review/prompt (must come before /:reviewId routes)
tabularRouter.post("/prompt", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const title =
        typeof req.body.title === "string" ? req.body.title.trim() : "";
    if (!title)
        return void res.status(400).json({ detail: "title is required" });

    const format: string =
        typeof req.body.format === "string" ? req.body.format : "text";
    const documentName: string =
        typeof req.body.documentName === "string"
            ? req.body.documentName.trim()
            : "";
    const tags: string[] = Array.isArray(req.body.tags)
        ? req.body.tags.filter((t: unknown) => typeof t === "string")
        : [];

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
            res.json({ prompt: parsed.prompt.trim(), source: "llm" });
        } else {
            res.status(502).json({ detail: "LLM returned an empty prompt" });
        }
    } catch {
        res.status(502).json({ detail: "Failed to generate prompt from LLM" });
    }
});

// GET /tabular-review/:reviewId
tabularRouter.get("/:reviewId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (error || !review)
        return void res.status(404).json({ detail: "Review not found" });
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok)
        return void res.status(404).json({ detail: "Review not found" });

    const { data: cells, error: cellsError } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);
    if (cellsError)
        return void res.status(500).json({ detail: cellsError.message });
    const rows = await loadReviewRows(db, reviewId);
    const rowDocIds = rows.flatMap((row) => row.source_document_ids ?? []);
    const docIds = Array.isArray(review.document_ids)
        ? (review.document_ids as string[])
        : rowDocIds;
    const docsResult =
        docIds.length > 0
            ? await db.from("documents").select("*").in("id", docIds)
            : { data: [] as Record<string, unknown>[] };
    const docs = (docsResult.data ?? []) as unknown as {
        id: string;
        current_version_id?: string | null;
    }[];
    await attachActiveVersionPaths(db, docs);

    res.json({
        review: { ...review, is_owner: access.isOwner },
        cells: (cells ?? []).map((cell) => ({
            ...cell,
            content: parseCellContent(cell.content),
        })),
        rows,
        documents: docs,
    });
});

// GET /tabular-review/:reviewId/people
// Owner email + display_name plus member display_names — the analog of
// /projects/:id/people. Used by the standalone TR detail page's People
// modal so the roster can show display_names alongside emails.
tabularRouter.get("/:reviewId/people", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const { data: review } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id, shared_with")
        .eq("id", reviewId)
        .single();
    if (!review)
        return void res.status(404).json({ detail: "Review not found" });
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok)
        return void res.status(404).json({ detail: "Review not found" });

    const sharedWith: string[] = (
        Array.isArray(review.shared_with)
            ? (review.shared_with as string[])
            : []
    ).map((e) => (e ?? "").toLowerCase());

    // Use the mirrored profile email so sharing checks do not scan auth.users.
    const { userByEmail, userById } = await loadProfileUsersByEmail(db);

    const ownerInfo = userById.get(review.user_id as string);
    res.json({
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
    });
});

// PATCH /tabular-review/:reviewId
tabularRouter.patch("/:reviewId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const updates: Record<string, unknown> = {};
    if (req.body.title != null) updates.title = req.body.title;
    const projectIdUpdateProvided = req.body.project_id !== undefined;
    const projectIdUpdate =
        req.body.project_id === null
            ? null
            : typeof req.body.project_id === "string" &&
                req.body.project_id.trim()
              ? req.body.project_id.trim()
              : undefined;
    if (projectIdUpdateProvided && projectIdUpdate === undefined) {
        return void res.status(400).json({
            detail: "project_id must be a non-empty string or null",
        });
    }
    // shared_with edits are owner-only — gated below after we know who's
    // making the call. Normalize lowercase + dedupe + drop empties.
    let sharedWithUpdate: string[] | undefined;
    if (Array.isArray(req.body.shared_with)) {
        const normalizedUserEmail = userEmail?.trim().toLowerCase();
        const seen = new Set<string>();
        const cleaned: string[] = [];
        for (const raw of req.body.shared_with) {
            if (typeof raw !== "string") continue;
            const e = raw.trim().toLowerCase();
            if (!e || seen.has(e)) continue;
            if (normalizedUserEmail && e === normalizedUserEmail) {
                return void res.status(400).json({
                    detail: "You cannot share a tabular review with yourself.",
                });
            }
            seen.add(e);
            cleaned.push(e);
        }
        sharedWithUpdate = cleaned;
    }
    updates.updated_at = new Date().toISOString();

    const db = createServerSupabase();
    const { data: existingReview, error: reviewError } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (reviewError || !existingReview)
        return void res.status(404).json({ detail: "Review not found" });
    const access = await ensureReviewAccess(
        existingReview,
        userId,
        userEmail,
        db,
    );
    if (!access.ok)
        return void res.status(404).json({ detail: "Review not found" });
    if (
        (req.body.title != null ||
            req.body.document_ids != null ||
            req.body.document_grouping != null) &&
        !access.isOwner
    ) {
        return void res.status(403).json({
            detail: "Only the review owner can change review settings",
        });
    }
    if (req.body.columns_config != null) {
        if (!access.isOwner) {
            return void res.status(403).json({
                detail: "Only the review owner can change columns",
            });
        }
        updates.columns_config = req.body.columns_config;
    }
    if (req.body.document_grouping != null) {
        if (
            req.body.document_grouping !== "document" &&
            req.body.document_grouping !== "folder"
        ) {
            return void res.status(400).json({
                detail: "document_grouping must be document or folder",
            });
        }
        updates.document_grouping = req.body.document_grouping;
    }
    if (Array.isArray(req.body.document_ids)) {
        updates.document_ids = await filterAccessibleDocumentIds(
            req.body.document_ids,
            userId,
            userEmail,
            db,
        );
    }
    if (sharedWithUpdate !== undefined) {
        if (!access.isOwner)
            return void res
                .status(403)
                .json({ detail: "Only the review owner can change sharing" });
        const missingSharedUsers = await findMissingUserEmails(
            db,
            sharedWithUpdate,
        );
        if (missingSharedUsers.length > 0) {
            return void res.status(400).json({
                detail: `${missingSharedUsers[0]} does not belong to a Mike user.`,
            });
        }
        updates.shared_with = sharedWithUpdate;
    }
    if (projectIdUpdateProvided) {
        if (!access.isOwner) {
            return void res.status(403).json({
                detail: "Only the review owner can move a review",
            });
        }
        if (projectIdUpdate) {
            const projectAccess = await checkProjectAccess(
                projectIdUpdate,
                userId,
                userEmail,
                db,
            );
            if (!projectAccess.ok) {
                return void res
                    .status(404)
                    .json({ detail: "Target project not found" });
            }
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
        return void res.status(500).json({
            detail: updateError?.message ?? "Failed to update review",
        });

    const rowShapeChanged =
        Array.isArray(req.body.document_ids) ||
        req.body.document_grouping != null ||
        projectIdUpdateProvided;
    try {
        const activeColumns = (updatedReview.columns_config ?? []) as Column[];
        if (rowShapeChanged) {
            await rebuildRowsForReview(
                db,
                reviewId,
                userId,
                (updatedReview.document_ids ?? []) as string[],
                activeColumns,
                normalizeGrouping(updatedReview.document_grouping),
            );
        } else if (Array.isArray(req.body.columns_config)) {
            await syncCellsForReviewRows(db, reviewId, activeColumns);
        }
    } catch (error) {
        return void res.status(500).json({
            detail:
                error instanceof Error
                    ? error.message
                    : "Failed to synchronize review rows",
        });
    }

    res.json(updatedReview);
});

// DELETE /tabular-review/:reviewId
tabularRouter.delete("/:reviewId", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const { reviewId } = req.params;
    const db = createServerSupabase();
    const { error } = await db
        .from("tabular_reviews")
        .delete()
        .eq("id", reviewId)
        .eq("user_id", userId);
    if (error) return void res.status(500).json({ detail: error.message });
    res.status(204).send();
});

// POST /tabular-review/:reviewId/clear-cells
// Reset cells to an empty/pending state for the given row_ids. Does not
// delete the rows — it blanks `content` and sets `status` back to "pending".
tabularRouter.post("/:reviewId/clear-cells", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const { row_ids } = req.body as { row_ids?: string[] };

    if (!Array.isArray(row_ids) || row_ids.length === 0)
        return void res.status(400).json({ detail: "row_ids is required" });

    const db = createServerSupabase();
    const { data: review, error: reviewError } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id")
        .eq("id", reviewId)
        .single();
    if (reviewError || !review)
        return void res.status(404).json({ detail: "Review not found" });
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok)
        return void res.status(404).json({ detail: "Review not found" });

    const { error } = await db
        .from("tabular_cells")
        .update({ content: null, status: "pending" })
        .eq("review_id", reviewId)
        .in("row_id", row_ids);
    if (error) return void res.status(500).json({ detail: error.message });
    res.status(204).send();
});

// POST /tabular-review/:reviewId/regenerate-cell
tabularRouter.post(
    "/:reviewId/regenerate-cell",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { reviewId } = req.params;
        const { row_id, column_index } = req.body as {
            row_id?: string;
            column_index: number;
        };

        if (!row_id || column_index == null)
            return void res
                .status(400)
                .json({ detail: "row_id and column_index are required" });

        const db = createServerSupabase();
        const { data: review, error: reviewError } = await db
            .from("tabular_reviews")
            .select("*")
            .eq("id", reviewId)
            .single();
        if (reviewError || !review)
            return void res.status(404).json({ detail: "Review not found" });
        const access = await ensureReviewAccess(review, userId, userEmail, db);
        if (!access.ok)
            return void res.status(404).json({ detail: "Review not found" });

        const column = (
            review.columns_config as {
                index: number;
                name: string;
                prompt: string;
                format?: string;
                tags?: string[];
            }[]
        ).find((c) => c.index === column_index);
        if (!column)
            return void res.status(400).json({ detail: "Column not found" });

        const rows = await loadReviewRows(db, reviewId);
        const row = rows.find((candidate) => candidate.id === row_id);
        if (!row)
            return void res
                .status(404)
                .json({ detail: "Review row not found" });
        const sourceIds = row.source_document_ids ?? [];
        const allowedSourceIds = await filterAccessibleDocumentIds(
            sourceIds,
            userId,
            userEmail,
            db,
        );
        if (allowedSourceIds.length !== sourceIds.length)
            return void res
                .status(404)
                .json({ detail: "Review row not found" });

        const { tabular_model, api_keys } = await getUserModelSettings(
            userId,
            db,
        );
        const missingKey = missingModelApiKey(tabular_model, api_keys);
        if (missingKey) {
            return void res.status(422).json({
                code: "missing_api_key",
                ...missingKey,
            });
        }

        await db
            .from("tabular_cells")
            .update({ status: "generating", content: null })
            .eq("review_id", reviewId)
            .eq("row_id", row.id)
            .eq("column_index", column_index);

        // Async path: enqueue a single-cell job (deduped on
        // extract:<review>:<row>:<col>) and wait for the cell to reach a
        // terminal state, so the response keeps its synchronous JSON shape.
        // The work itself is durable: if this request drops or times out the
        // worker still finishes and the client catches up via the DB or the
        // GET generate/stream view.
        if (process.env.ASYNC_TABULAR_EXTRACTION === "true") {
            try {
                await enqueueExtraction({
                    reviewId,
                    userId,
                    rowId: row.id,
                    columnIndex: column_index,
                });
            } catch (err) {
                console.error(
                    "[tabular/regenerate-cell] enqueue failed",
                    safeErrorLog(err),
                );
                await db
                    .from("tabular_cells")
                    .update({ status: "error" })
                    .eq("review_id", reviewId)
                    .eq("row_id", row.id)
                    .eq("column_index", column_index);
                return void res
                    .status(500)
                    .json({ detail: "Generation failed" });
            }

            const terminal = await awaitCellTerminal({
                db,
                reviewId,
                rowId: row.id,
                columnIndex: column_index,
                log: console,
            });
            if (terminal === null)
                // Still running after the wait budget — the job survives this
                // response; the client keeps the cell "generating" and picks
                // the result up from the resume stream or a reload.
                return void res.status(202).json({
                    status: "generating",
                    detail: "Extraction still running",
                });
            if (terminal.status === "error")
                return void res
                    .status(500)
                    .json({ detail: "Generation failed" });
            return void res.json(terminal.content);
        }

        const markdown = await loadRowDocumentText(db, row);

        const result = await queryTabularCell(
            tabular_model,
            row.label,
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
                .eq("row_id", row.id)
                .eq("column_index", column_index);
            return void res.status(500).json({ detail: "Generation failed" });
        }

        await db
            .from("tabular_cells")
            .update({ content: JSON.stringify(result), status: "done" })
            .eq("review_id", reviewId)
            .eq("row_id", row.id)
            .eq("column_index", column_index);

        res.json(result);
    },
);

// POST /tabular-review/:reviewId/generate
tabularRouter.post("/:reviewId/generate", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    const prepared = await prepareTabularGenerate(db, {
        reviewId,
        userId,
        userEmail,
    });
    if (!prepared.ok) {
        if (prepared.kind === "not_found")
            return void res.status(404).json({ detail: "Review not found" });
        if (prepared.kind === "no_columns")
            return void res
                .status(400)
                .json({ detail: "No columns configured" });
        if (prepared.kind === "cells_error")
            return void res.status(500).json({ detail: prepared.message });
        return void res.status(422).json({
            code: "missing_api_key",
            ...prepared.missingKey,
        });
    }

    // Async path: hand extraction to the durable BullMQ queue and turn this
    // request into a reconnectable view that tails progress. The work survives
    // a disconnect and retries on failure. Falls through to the historical
    // inline path when the flag is off (no Redis required).
    if (process.env.ASYNC_TABULAR_EXTRACTION === "true") {
        await streamTabularGenerateAsync({
            res,
            db,
            reviewId,
            userId,
            prepared: prepared.data,
            log: console,
        });
        return;
    }

    const { columns, cellMap, rows, tabular_model, api_keys } = prepared.data;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const write = (line: string) => res.write(line);

    const cellFrame = (
        rowId: string,
        columnIndex: number,
        content: unknown,
        status: "generating" | "done" | "error",
    ): void => {
        write(
            `data: ${JSON.stringify({ type: "cell_update", row_id: rowId, column_index: columnIndex, content, status })}\n\n`,
        );
    };

    try {
        await Promise.all(
            rows.map(async (row) => {
                const existingByColumn = new Map<
                    number,
                    Record<string, unknown>
                >();
                for (const col of columns) {
                    const cell = cellMap.get(`${row.id}:${col.index}`);
                    if (cell) existingByColumn.set(col.index, cell);
                }

                // Shared extraction core (identical to the async worker); the
                // sink writes SSE frames. Columns the model omits come back in
                // `missing` — the synchronous path marks them "error" inline
                // (the async path retries them instead).
                const { missing } = await extractRowColumns({
                    db,
                    reviewId,
                    row,
                    columns,
                    existingByColumn,
                    model: tabular_model,
                    apiKeys: api_keys,
                    sink: {
                        generating: (rowId, ci) =>
                            cellFrame(rowId, ci, null, "generating"),
                        done: (rowId, ci, result) =>
                            cellFrame(rowId, ci, result, "done"),
                    },
                });

                for (const columnIndex of missing) {
                    await db
                        .from("tabular_cells")
                        .update({ status: "error" })
                        .eq("review_id", reviewId)
                        .eq("row_id", row.id)
                        .eq("column_index", columnIndex);
                    cellFrame(row.id, columnIndex, null, "error");
                }
            }),
        );

        write("data: [DONE]\n\n");
    } catch (err) {
        console.error("[tabular/generate] stream error", safeErrorLog(err));
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message: safeErrorMessage(err, "Stream error") })}\n\ndata: [DONE]\n\n`,
            );
        } catch {
            // Best-effort error notification: if the client has already
            // disconnected the SSE write throws. We are in the error path with
            // nothing left to do, so swallow and let `finally` end the stream.
        }
    } finally {
        res.end();
    }
});

// GET /tabular-review/:reviewId/generate/stream — reconnect to an in-flight (or
// just-finished) generate run without re-triggering work. A client whose POST
// /generate stream dropped can resume here and catch up on the remaining cells.
// Pure observer: it never enqueues. (Registered before the /:reviewId/chats
// group; no path collision since the segments differ.)
tabularRouter.get(
    "/:reviewId/generate/stream",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { reviewId } = req.params;
        const db = createServerSupabase();

        const prepared = await prepareTabularGenerate(db, {
            reviewId,
            userId,
            userEmail,
        });
        if (!prepared.ok) {
            if (prepared.kind === "not_found")
                return void res
                    .status(404)
                    .json({ detail: "Review not found" });
            if (prepared.kind === "no_columns")
                return void res
                    .status(400)
                    .json({ detail: "No columns configured" });
            if (prepared.kind === "cells_error")
                return void res.status(500).json({ detail: prepared.message });
            return void res.status(422).json({
                code: "missing_api_key",
                ...prepared.missingKey,
            });
        }

        await streamTabularRunView({
            res,
            db,
            reviewId,
            prepared: prepared.data,
            log: console,
        });
    },
);

// GET /tabular-review/:reviewId/chats — list chats (metadata only, no messages)
tabularRouter.get("/:reviewId/chats", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const db = createServerSupabase();

    // Verify access (owner or shared-project member).
    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id")
        .eq("id", reviewId)
        .single();
    if (error || !review)
        return void res.status(404).json({ detail: "Review not found" });
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok)
        return void res.status(404).json({ detail: "Review not found" });

    // Show every member's chats for the review (collaborative), not just
    // the requester's. Per-chat access is gated above by review access.
    const { data: chats } = await db
        .from("tabular_review_chats")
        .select("id, title, created_at, updated_at, user_id")
        .eq("review_id", reviewId)
        .order("updated_at", { ascending: false });

    res.json(chats ?? []);
});

// DELETE /tabular-review/:reviewId/chats/:chatId — delete a single chat
tabularRouter.delete(
    "/:reviewId/chats/:chatId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const { chatId } = req.params;
        const db = createServerSupabase();
        // Owner-only delete — sibling collaborators shouldn't be able to wipe
        // each other's threads.
        const { error } = await db
            .from("tabular_review_chats")
            .delete()
            .eq("id", chatId)
            .eq("user_id", userId);
        if (error) return void res.status(500).json({ detail: error.message });
        res.status(204).send();
    },
);

// PATCH /tabular-review/:reviewId/chats/:chatId — rename a chat
tabularRouter.patch(
    "/:reviewId/chats/:chatId",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const { chatId } = req.params;
        const title =
            typeof req.body?.title === "string" ? req.body.title.trim() : "";
        if (!title)
            return void res.status(400).json({ detail: "Title is required" });
        const db = createServerSupabase();
        // Owner-only rename — mirrors the delete rule above.
        const { error } = await db
            .from("tabular_review_chats")
            .update({ title: title.slice(0, 200) })
            .eq("id", chatId)
            .eq("user_id", userId);
        if (error) return void res.status(500).json({ detail: error.message });
        res.status(204).send();
    },
);

// GET /tabular-review/:reviewId/chats/:chatId/messages — messages for a single chat
tabularRouter.get(
    "/:reviewId/chats/:chatId/messages",
    requireAuth,
    async (req, res) => {
        const userId = res.locals.userId as string;
        const userEmail = res.locals.userEmail as string | undefined;
        const { reviewId, chatId } = req.params;
        const db = createServerSupabase();

        const { data: review } = await db
            .from("tabular_reviews")
            .select("id, user_id, project_id")
            .eq("id", reviewId)
            .single();
        if (!review)
            return void res.status(404).json({ detail: "Review not found" });
        const access = await ensureReviewAccess(review, userId, userEmail, db);
        if (!access.ok)
            return void res.status(404).json({ detail: "Review not found" });

        const { data: chat, error: chatError } = await db
            .from("tabular_review_chats")
            .select("id, review_id")
            .eq("id", chatId)
            .single();
        if (chatError || !chat || chat.review_id !== reviewId)
            return void res.status(404).json({ detail: "Chat not found" });

        const { data: messages } = await db
            .from("tabular_review_chat_messages")
            .select("id, role, content, annotations, created_at")
            .eq("chat_id", chatId)
            .order("created_at", { ascending: true });

        res.json(messages ?? []);
    },
);

// ---------------------------------------------------------------------------
// POST /tabular-review/:reviewId/chat — agentic streaming
// ---------------------------------------------------------------------------

// POST /tabular-review/:reviewId/chat
tabularRouter.post("/:reviewId/chat", requireAuth, async (req, res) => {
    const userId = res.locals.userId as string;
    const userEmail = res.locals.userEmail as string | undefined;
    const { reviewId } = req.params;
    const {
        messages,
        chat_id: existingChatId,
        review_title: clientReviewTitle,
        project_name: clientProjectName,
    } = req.body as {
        messages: ChatMessage[];
        chat_id?: string;
        review_title?: string;
        project_name?: string;
    };

    const lastUser = [...(messages ?? [])]
        .reverse()
        .find((m) => m.role === "user");
    if (!lastUser?.content?.trim()) {
        return void res
            .status(400)
            .json({ detail: "messages must include a user message" });
    }

    const db = createServerSupabase();
    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (error || !review)
        return void res.status(404).json({ detail: "Review not found" });
    const reviewAccess = await ensureReviewAccess(
        review,
        userId,
        userEmail,
        db,
    );
    if (!reviewAccess.ok)
        return void res.status(404).json({ detail: "Review not found" });

    // Fetch all cells and logical review rows for this review.
    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);
    const rows = await loadReviewRows(db, reviewId);

    const sortedColumns = (
        (review.columns_config ?? []) as { index: number; name: string }[]
    ).sort((a, b) => a.index - b.index);

    const tabularStore: TabularCellStore = {
        columns: sortedColumns,
        documents: rows.map((row) => ({
            id: row.id,
            filename: row.label,
        })),
        cells: new Map(
            (cells ?? []).map((c: any) => [
                `${c.column_index}:${c.row_id}`,
                parseCellContent(c.content),
            ]),
        ),
    };

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) {
        return void res.status(422).json({
            code: "missing_api_key",
            ...missingKey,
        });
    }

    // Create or verify chat record
    let chatId = existingChatId ?? null;
    let chatTitle: string | null = null;
    const isFirstExchange =
        messages.filter((m) => m.role === "user").length === 1;

    if (chatId) {
        // The chat must belong to this exact review and to the requester.
        // Review access alone is not enough: otherwise a user could reuse one
        // of their chats from a different review in this route.
        const { data: existing } = await db
            .from("tabular_review_chats")
            .select("id, title, review_id, user_id")
            .eq("id", chatId)
            .single();
        const canUse =
            !!existing &&
            existing.review_id === reviewId &&
            existing.user_id === userId;
        if (!canUse || !existing) chatId = null;
        else chatTitle = existing.title;
    }

    if (!chatId) {
        const { data: newChat } = await db
            .from("tabular_review_chats")
            .insert({ review_id: reviewId, user_id: userId })
            .select("id, title")
            .single();
        chatId = newChat?.id ?? null;
        chatTitle = newChat?.title ?? null;
    }

    // Persist user message
    if (chatId) {
        await db.from("tabular_review_chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: lastUser.content,
        });
    }

    const apiMessages = buildTabularMessages(
        messages,
        tabularStore,
        review.title || "Untitled Review",
    );

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    const write = (line: string) => res.write(line);
    const streamAbort = new AbortController();
    let streamFinished = false;
    res.on("close", () => {
        if (!streamFinished) streamAbort.abort();
    });

    if (chatId) {
        write(`data: ${JSON.stringify({ type: "chat_id", chatId })}\n\n`);
    }

    try {
        const { fullText, events } = await runLLMStream({
            apiMessages,
            docStore: new Map(),
            docIndex: {},
            userId,
            db,
            write,
            extraTools: TABULAR_TOOLS,
            includeResearchTools: false,
            tabularStore,
            buildCitations: (text) =>
                extractTabularAnnotations(text, tabularStore),
            model: tabular_model,
            apiKeys: api_keys,
            signal: streamAbort.signal,
        });

        const persistedEvents = stripTransientAssistantEvents(events);
        const annotations = extractTabularAnnotations(fullText, tabularStore);

        if (chatId) {
            await db.from("tabular_review_chat_messages").insert({
                chat_id: chatId,
                role: "assistant",
                content: persistedEvents.length ? persistedEvents : null,
                annotations: annotations.length ? annotations : null,
            });
            await db
                .from("tabular_review_chats")
                .update({ updated_at: new Date().toISOString() })
                .eq("id", chatId);
        }

        // Generate title on first exchange
        if (chatId && isFirstExchange && !chatTitle && lastUser.content) {
            const { title_model } = await getUserModelSettings(userId, db);
            const title = await generateChatTitle(
                title_model,
                lastUser.content,
                {
                    reviewTitle: clientReviewTitle ?? review.title ?? null,
                    projectName: clientProjectName ?? null,
                },
                api_keys,
            );
            if (title) {
                await db
                    .from("tabular_review_chats")
                    .update({ title })
                    .eq("id", chatId);
                write(
                    `data: ${JSON.stringify({ type: "chat_title", chatId, title })}\n\n`,
                );
            }
        }
    } catch (err) {
        if (isAbortError(err)) {
            console.log("[tabular/chat] client aborted stream", { chatId });
            if (chatId && err instanceof AssistantStreamError) {
                const partial = buildCancelledAssistantMessage({
                    fullText: err.fullText,
                    events: err.events,
                    buildCitations: (fullText) =>
                        extractTabularAnnotations(fullText, tabularStore),
                });
                const annotations = partial.citations;
                const { error: saveError } = await db
                    .from("tabular_review_chat_messages")
                    .insert({
                        chat_id: chatId,
                        role: "assistant",
                        content: partial.events.length ? partial.events : null,
                        annotations: annotations.length
                            ? annotations
                            : null,
                    });
                if (saveError) {
                    console.error(
                        "[tabular/chat] failed to save aborted stream",
                        saveError,
                    );
                }
                await db
                    .from("tabular_review_chats")
                    .update({ updated_at: new Date().toISOString() })
                    .eq("id", chatId);
            }
            return;
        }
        console.error("[tabular/chat] error", safeErrorLog(err));
        const message = safeErrorMessage(err, "Stream error");
        const errorEvents = err instanceof AssistantStreamError
            ? stripTransientAssistantEvents(err.events)
            : [{ type: "error" as const, message }];
        const errorFullText =
            err instanceof AssistantStreamError ? err.fullText : "";
        if (chatId) {
            try {
                const annotations = extractTabularAnnotations(
                    errorFullText,
                    tabularStore,
                );
                const { error: saveError } = await db
                    .from("tabular_review_chat_messages")
                    .insert({
                        chat_id: chatId,
                        role: "assistant",
                        content: errorEvents.length ? errorEvents : null,
                        annotations: annotations.length ? annotations : null,
                    });
                if (saveError)
                    console.error("[tabular/chat] failed to save error", saveError);
            } catch (saveErr) {
                console.error("[tabular/chat] failed to save error", saveErr);
            }
        }
        try {
            write(
                `data: ${JSON.stringify({ type: "error", message })}\n\n`,
            );
            write("data: [DONE]\n\n");
        } catch {
            /* ignore */
        }
    } finally {
        streamFinished = true;
        res.end();
    }
});

