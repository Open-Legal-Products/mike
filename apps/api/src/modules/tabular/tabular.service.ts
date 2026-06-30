// Business logic + data-access for the tabular-review module.
//
// These functions are the service layer behind tabular.routes.ts. They take an
// explicit Supabase client (`db`) plus request-derived primitives, perform the
// review / cell / document orchestration, and RETURN values or typed error
// results. They never touch req/res — the thin route handlers map the results
// onto HTTP status codes, headers, and response bodies.
//
// STREAMING: the SSE endpoints (POST /:reviewId/chat and /:reviewId/generate)
// keep their streaming loop, abort handling, and per-token persistence in the
// route. Only the NON-streaming work is extracted here — including the pre-stream
// "prepare" guards (access checks, document loading, missing-API-key checks, and
// chat-record setup) that return the data the route then streams over.

import { createServerSupabase } from "../../lib/supabase";
import { logger } from "../../lib/logger";
import { downloadFile } from "../../lib/storage";
import {
    attachActiveVersionPaths,
    loadActiveVersion,
} from "../../lib/documentVersions";
import { normalizeDocxZipPaths } from "../../lib/convert";
import {
    type ChatMessage,
    type TabularCellStore,
} from "../../lib/chatTools";
import {
    completeText,
    providerForModel,
    streamChatWithTools,
    type Provider,
    type UserApiKeys,
} from "../../lib/llm";
import { getUserModelSettings } from "../../lib/userSettings";
import {
    checkProjectAccess,
    ensureReviewAccess,
    filterAccessibleDocumentIds,
} from "../../lib/access";
import { safeErrorLog } from "../../lib/safeError";
import { loadPdfjs } from "../../lib/pdfjs";

type Db = ReturnType<typeof createServerSupabase>;

// Structural slice of pino's Logger — service functions only ever .error().
type Log = Pick<typeof logger, "error">;

// ---------------------------------------------------------------------------
// Prompt formatting + model helpers
// ---------------------------------------------------------------------------

export function formatPromptSuffix(format?: string, tags?: string[]): string {
    switch (format) {
        case "bulleted_list":
            return ' The "summary" field in your JSON response must be a markdown bulleted list only — no prose. Format: each item on its own line, prefixed with "* " (asterisk + single space), e.g.\n* First item\n* Second item\n* Third item';
        case "number":
            return ' The "summary" field in your JSON response must be a single number only. No units or explanation.';
        case "percentage":
            return ' The "summary" field in your JSON response must be a single percentage value only (e.g. 42%). No explanation.';
        case "monetary_amount":
            return ' The "summary" field in your JSON response must be the monetary value only, including currency symbol (e.g. $1,234.56). No explanation.';
        case "currency":
            return ' The "summary" field in your JSON response must contain only the currency code(s). Wrap each code in double square brackets, e.g. [[USD]] or [[EUR]]. No other text.';
        case "yes_no":
            return ' The "summary" field in your JSON response must be [[Yes]] or [[No]] only. The "reasoning" field MUST include an inline citation [[page:N||quote:verbatim excerpt ≤25 words]] pointing to the exact language in the document that supports the Yes/No answer.';
        case "date":
            return ' The "summary" field in your JSON response must be the date only in DD Month YYYY format (e.g. 1 January 2024). If a range, give both dates separated by an em dash. The "reasoning" field MUST include an inline citation [[page:N||quote:verbatim excerpt ≤25 words]] pointing to the exact place in the document where the date is found.';
        case "tag":
            return tags?.length
                ? ` The \"summary\" field in your JSON response must contain exactly one tag wrapped in double square brackets. Available tags: ${tags.map((t) => `[[${t}]]`).join(", ")}. No other text. The \"reasoning\" field MUST include an inline citation [[page:N||quote:verbatim excerpt ≤25 words]] pointing to the exact language in the document that supports the chosen tag.`
                : "";
        default:
            return "";
    }
}

function providerLabel(provider: Provider): string {
    if (provider === "claude") return "Anthropic";
    if (provider === "openai") return "OpenAI";
    return "Gemini";
}

export type MissingApiKey = {
    provider: Provider;
    model: string;
    detail: string;
};

export function missingModelApiKey(
    model: string,
    apiKeys: UserApiKeys,
): MissingApiKey | null {
    const provider = providerForModel(model);
    if (apiKeys[provider]?.trim()) return null;
    return {
        provider,
        model,
        detail: `${providerLabel(provider)} API key is required to use ${model}. Add an API key or select a different tabular review model.`,
    };
}

// ---------------------------------------------------------------------------
// Cell content parsing
// ---------------------------------------------------------------------------

export function parseCellContent(
    raw: unknown,
): { summary: string; flag?: string; reasoning?: string } | null {
    if (!raw) return null;
    if (typeof raw === "object" && raw !== null && "summary" in raw) {
        const c = raw as {
            summary?: unknown;
            flag?: unknown;
            reasoning?: unknown;
        };
        return {
            summary: String(c.summary ?? ""),
            flag: (["green", "grey", "yellow", "red"] as const).includes(
                c.flag as "green",
            )
                ? (c.flag as string)
                : undefined,
            reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
        };
    }
    if (typeof raw === "string") {
        try {
            const p = JSON.parse(raw) as {
                summary?: unknown;
                value?: unknown;
                flag?: unknown;
                reasoning?: unknown;
            };
            return {
                summary: String(p.summary ?? p.value ?? "").trim(),
                flag: (["green", "grey", "yellow", "red"] as const).includes(
                    p.flag as "green",
                )
                    ? (p.flag as string)
                    : undefined,
                reasoning: typeof p.reasoning === "string" ? p.reasoning : "",
            };
        } catch {
            return { summary: raw, flag: "grey", reasoning: "" };
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Tabular citation parsing
// ---------------------------------------------------------------------------

type TabularParsedCitation = {
    ref: number;
    col_index: number;
    row_index: number;
    quote: string;
};

const TABULAR_CITATIONS_BLOCK_RE = /<CITATIONS>\s*([\s\S]*?)\s*<\/CITATIONS>/;

function parseTabularCitations(text: string): TabularParsedCitation[] {
    const match = text.match(TABULAR_CITATIONS_BLOCK_RE);
    if (!match) return [];
    try {
        return JSON.parse(match[1]) as TabularParsedCitation[];
    } catch {
        return [];
    }
}

export function extractTabularAnnotations(
    fullText: string,
    tabularStore: TabularCellStore,
) {
    return parseTabularCitations(fullText).map((c) => ({
        type: "tabular_citation" as const,
        ref: c.ref,
        col_index: c.col_index,
        row_index: c.row_index,
        col_name:
            tabularStore.columns[c.col_index]?.name ?? `Col ${c.col_index}`,
        doc_name:
            tabularStore.documents[c.row_index]?.filename ??
            `Row ${c.row_index}`,
        quote: c.quote,
    }));
}

// ---------------------------------------------------------------------------
// Build messages for tabular chat
// ---------------------------------------------------------------------------

function buildTabularMessages(
    messages: ChatMessage[],
    tabularStore: TabularCellStore,
    reviewTitle: string,
): unknown[] {
    const docList = tabularStore.documents
        .map((d, i) => `- ROW:${i} "${d.filename}"`)
        .join("\n");
    const colList = tabularStore.columns
        .map((c, i) => `- COL:${i} "${c.name}"`)
        .join("\n");

    const systemContent = `You are Mike, an AI legal assistant. You are helping with the tabular review titled "${reviewTitle}".

The review extracts specific fields from multiple legal documents into a structured table.
You do NOT have the cell content yet — call read_table_cells to fetch the cells you need before answering.

DOCUMENTS (rows):
${docList || "- (none)"}

COLUMNS (fields):
${colList || "- (none)"}

TABULAR CITATION INSTRUCTIONS:
When you reference specific cell content, place a numbered marker [1], [2], etc. inline in your prose at the point of reference.

After your complete response, append a <CITATIONS> block containing a JSON array with one entry per marker:

<CITATIONS>
[
  {"ref": 1, "col_index": 0, "row_index": 2, "quote": "verbatim text from the cell"},
  {"ref": 2, "col_index": 1, "row_index": 0, "quote": "another excerpt"}
]
</CITATIONS>

Rules:
- col_index and row_index are 0-based (matching the COL/ROW numbers listed above)
- Only cite cells you have read via read_table_cells
- quote should be verbatim text from the cell's summary
- Omit <CITATIONS> if you make no citations
- Do not fabricate cell content
- Answer in clear, concise prose. You may use markdown formatting.`;

    const formatted: unknown[] = [{ role: "system", content: systemContent }];
    for (const msg of messages) {
        formatted.push({ role: msg.role, content: msg.content ?? "" });
    }
    return formatted;
}

// ---------------------------------------------------------------------------
// LLM extraction helpers
// ---------------------------------------------------------------------------

async function queryTabularCell(
    model: string,
    filename: string,
    documentText: string,
    columnPrompt: string,
    format?: string,
    tags?: string[],
    apiKeys?: UserApiKeys,
): Promise<CellResult | null> {
    const suffix = formatPromptSuffix(format as never, tags);
    const fullPrompt = `${columnPrompt}${suffix} If not found, state "Not Found". Leave all reasoning and explanation in the "reasoning" field only.`;

    const EXTRACTION_SYSTEM = `You are a legal document analyst. Return ONLY valid JSON:
{"summary": string, "flag": "green"|"grey"|"yellow"|"red", "reasoning": string}

The "summary" and "reasoning" field values may use markdown formatting (bullets, bold, italics, etc.) — the values are still plain JSON strings (escape newlines as \\n), but the text inside will be rendered as markdown in the UI.

The "summary" field must contain only the extracted value with inline citations — no explanation or reasoning. Every factual claim in "summary" must be followed immediately by a citation in the format [[page:N||quote:exact quoted text]], where N is the page number and the quote is a short verbatim excerpt (≤ 25 words). The quote must be narrowly scoped to the specific claim it supports — extract only the exact words that support that statement, not the surrounding sentence or paragraph. Do not have multiple claims share the same long quote; if two different statements need different evidence, give each its own short, narrowly-scoped quote. All reasoning and explanation belongs in "reasoning" only, which may also contain citations.`;

    let raw: string;
    try {
        raw = await completeText({
            model,
            systemPrompt: EXTRACTION_SYSTEM,
            user: `Document: ${filename}\n\n${documentText.slice(0, 120_000)}\n\n---\nInstruction: ${fullPrompt}`,
            maxTokens: 2048,
            apiKeys,
        });
    } catch (err) {
        logger.error({ err: safeErrorLog(err) }, "[queryTabularCell] completion failed");
        return null;
    }
    try {
        const parsed = JSON.parse(
            raw
                .replace(/^```(?:json)?\n?/i, "")
                .replace(/\n?```$/, "")
                .trim(),
        ) as {
            summary?: unknown;
            value?: unknown;
            flag?: unknown;
            reasoning?: unknown;
        };
        return {
            summary:
                String(parsed.summary ?? parsed.value ?? "").trim() ||
                "Not addressed",
            flag: (["green", "grey", "yellow", "red"] as const).includes(
                parsed.flag as "green",
            )
                ? (parsed.flag as "green")
                : "grey",
            reasoning: String(parsed.reasoning ?? ""),
        };
    } catch {
        return raw.trim()
            ? {
                  summary: raw.trim().slice(0, 500),
                  flag: "grey" as const,
                  reasoning: "",
              }
            : null;
    }
}

export async function generateChatTitle(
    model: string,
    firstUserMessage: string,
    context?: { reviewTitle?: string | null; projectName?: string | null },
    apiKeys?: UserApiKeys,
): Promise<string | null> {
    try {
        const contextLines: string[] = [];
        if (context?.projectName)
            contextLines.push(`Project: ${context.projectName}`);
        if (context?.reviewTitle)
            contextLines.push(`Tabular review: ${context.reviewTitle}`);
        const contextBlock = contextLines.length
            ? `This chat is in the context of a tabular review.\n${contextLines.join("\n")}\n\n`
            : "";

        const raw = await completeText({
            model,
            user: `${contextBlock}Generate a short title (4-6 words) for a chat that starts with the message below. The title should reflect the user's specific question, not the review or project name. Return only the title, no punctuation, no quotes:\n\n${firstUserMessage}`,
            maxTokens: 64,
            apiKeys,
        });
        return raw.trim().slice(0, 80) || null;
    } catch {
        return null;
    }
}

function buildTabularContext(
    columns: any[],
    docs: any[],
    cells: any[],
): string {
    const lines: string[] = [
        "# Tabular Review Context\n",
        "Columns (0-based index):",
    ];
    columns.forEach((col: any, i: number) =>
        lines.push(`- COL:${i} → "${col.name}"`),
    );
    lines.push("", "Documents (0-based row index):");
    docs.forEach((doc: any, i: number) =>
        lines.push(`- ROW:${i} → "${doc.filename}"`),
    );
    lines.push("", "## Table Data\n");
    lines.push(`| Document | ${columns.map((c: any) => c.name).join(" | ")} |`);
    lines.push(`|---|${columns.map(() => "---").join("|")}|`);
    docs.forEach((doc: any, rowIdx: number) => {
        const rowCells = columns.map((col: any, colPos: number) => {
            const cell = cells.find(
                (c: any) =>
                    c.document_id === doc.id && c.column_index === col.index,
            );
            if (
                !cell ||
                cell.status === "pending" ||
                cell.status === "generating"
            ) {
                return `(pending) [[COL:${colPos}||ROW:${rowIdx}]]`;
            }
            if (cell.status === "error") {
                return `(error) [[COL:${colPos}||ROW:${rowIdx}]]`;
            }
            const content = parseCellContent(cell.content);
            const summary = content?.summary?.trim() || "(not yet generated)";
            const truncated =
                summary.length > 400 ? summary.slice(0, 400) + "…" : summary;
            return `${truncated} [[COL:${colPos}||ROW:${rowIdx}]]`;
        });
        lines.push(
            `| ROW:${rowIdx} ${doc.filename} | ${rowCells.join(" | ")} |`,
        );
    });
    return lines.join("\n");
}

type CellResult = {
    summary: string;
    flag: "green" | "grey" | "yellow" | "red";
    reasoning: string;
};
type Column = {
    index: number;
    name: string;
    prompt: string;
    format?: string;
    tags?: string[];
};

export async function queryTabularAllColumns(
    model: string,
    filename: string,
    documentText: string,
    columns: Column[],
    onResult: (columnIndex: number, result: CellResult) => Promise<void>,
    apiKeys?: UserApiKeys,
): Promise<void> {
    const columnsDesc = columns
        .map((col) => {
            const suffix = formatPromptSuffix(col.format as never, col.tags);
            const fullPrompt = `${col.prompt}${suffix} If not found, state "Not Found".`;
            return `Column ${col.index} — "${col.name}": ${fullPrompt}`;
        })
        .join("\n");

    const SYSTEM = `You are a legal document analyst. Extract information for each column listed below.

For each column, output exactly one minified JSON object on its own line (no line breaks inside the JSON), then a newline. Process columns in order and output each result as soon as you finish it.

Line format:
{"column_index": <N>, "summary": <string>, "flag": <"green"|"grey"|"yellow"|"red">, "reasoning": <string>}

Rules:
- "summary": the extracted value with inline citations [[page:N||quote:verbatim excerpt ≤25 words]] after every factual claim. No explanation or reasoning here. Quotes must be narrowly scoped to the specific claim — extract only the exact supporting words, not the full surrounding sentence. Do not reuse one long quote across multiple statements; give each claim its own short, precise quote.
- "flag": green = standard/favorable, yellow = needs attention, red = problematic/unfavorable, grey = neutral/not found
- "reasoning": brief explanation of the extraction
- The "summary" and "reasoning" string VALUES may use markdown (bullets, bold, italics, etc.) — escape newlines as \\n inside the JSON string. This markdown is rendered in the UI.
- Output ONLY the JSON lines themselves. Do NOT wrap the response in markdown code fences (e.g. \`\`\`json), and do not add any preamble or summary.`;

    const USER = `Document: ${filename}\n\n${documentText.slice(0, 120_000)}\n\n---\nColumns to extract:\n${columnsDesc}`;

    let contentBuffer = "";
    const pending: Promise<unknown>[] = [];

    const processLine = async (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        try {
            const parsed = JSON.parse(trimmed) as {
                column_index?: unknown;
                summary?: unknown;
                flag?: unknown;
                reasoning?: unknown;
            };
            if (typeof parsed.column_index !== "number") return;
            const col = columns.find((c) => c.index === parsed.column_index);
            if (!col) return;
            await onResult(parsed.column_index, {
                summary: String(parsed.summary ?? "").trim() || "Not addressed",
                flag: (["green", "grey", "yellow", "red"] as const).includes(
                    parsed.flag as "green",
                )
                    ? (parsed.flag as CellResult["flag"])
                    : "grey",
                reasoning: String(parsed.reasoning ?? ""),
            });
        } catch {
            // malformed line — skip
        }
    };

    try {
        await streamChatWithTools({
            model,
            systemPrompt: SYSTEM,
            messages: [{ role: "user", content: USER }],
            tools: [],
            apiKeys,
            callbacks: {
                onContentDelta: (delta) => {
                    contentBuffer += delta;
                    let newlineIdx: number;
                    while ((newlineIdx = contentBuffer.indexOf("\n")) !== -1) {
                        const completedLine = contentBuffer.slice(
                            0,
                            newlineIdx,
                        );
                        contentBuffer = contentBuffer.slice(newlineIdx + 1);
                        pending.push(processLine(completedLine));
                    }
                },
            },
        });
    } catch (err) {
        logger.error({ err: safeErrorLog(err) }, "[queryTabularAllColumns] stream failed");
    }

    if (contentBuffer.trim()) pending.push(processLine(contentBuffer));
    await Promise.all(pending);
}

// ---------------------------------------------------------------------------
// Document text extraction
// ---------------------------------------------------------------------------

export async function extractPdfMarkdown(buf: ArrayBuffer): Promise<string> {
    try {
        const pdfjsLib = await loadPdfjs();
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf) })
            .promise;
        const pages: string[] = [];
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const tc = await page.getTextContent();
            const text = tc.items
                .filter((it): it is { str: string } => "str" in it)
                .map((it) => it.str)
                .join(" ")
                .trim();
            if (text) pages.push(`## Page ${i}\n\n${text}`);
        }
        return pages.join("\n\n");
    } catch {
        return "";
    }
}

export async function extractDocxMarkdown(buf: ArrayBuffer): Promise<string> {
    try {
        const mammoth = await import("mammoth");
        const normalized = await normalizeDocxZipPaths(Buffer.from(buf));
        const { value: html } = await mammoth.convertToHtml({
            buffer: normalized,
        });
        return html
            .replace(
                /<h([1-6])[^>]*>(.*?)<\/h\1>/gi,
                (_, l, t) => "#".repeat(Number(l)) + " " + t + "\n\n",
            )
            .replace(/<strong[^>]*>(.*?)<\/strong>/gi, "**$1**")
            .replace(/<li[^>]*>(.*?)<\/li>/gi, "- $1\n")
            .replace(/<p[^>]*>(.*?)<\/p>/gi, "$1\n\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&nbsp;/g, " ")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    } catch {
        return "";
    }
}

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
    const { data: review, error } = await db
        .from("tabular_reviews")
        .insert({
            user_id: userId,
            title: title ?? null,
            columns_config,
            document_ids: allowedDocumentIds,
            project_id: project_id ?? null,
            workflow_id: workflow_id ?? null,
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
        .select("id, user_id, project_id, shared_with")
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

    // Same pattern as /projects/:id/people: walk auth.users to map emails
    // to user_ids, then pull display_names from user_profiles by user_id.
    const { data: usersData } = await db.auth.admin.listUsers({
        perPage: 1000,
    });
    const allUsers = usersData?.users ?? [];
    const userByEmail = new Map<string, { id: string; email: string }>();
    const userById = new Map<string, { id: string; email: string }>();
    for (const u of allUsers) {
        if (!u.email) continue;
        const lower = u.email.toLowerCase();
        userByEmail.set(lower, { id: u.id, email: u.email });
        userById.set(u.id, { id: u.id, email: u.email });
    }

    const memberUserIds: string[] = [];
    for (const email of sharedWith) {
        const u = userByEmail.get(email);
        if (u) memberUserIds.push(u.id);
    }

    const profileIds = [review.user_id as string, ...memberUserIds].filter(
        (x, i, arr) => arr.indexOf(x) === i,
    );

    const profileByUserId = new Map<string, string | null>();
    if (profileIds.length > 0) {
        const { data: profiles } = await db
            .from("user_profiles")
            .select("user_id, display_name")
            .in("user_id", profileIds);
        for (const p of profiles ?? []) {
            profileByUserId.set(
                p.user_id as string,
                (p.display_name as string | null) ?? null,
            );
        }
    }

    const ownerInfo = userById.get(review.user_id as string);
    return {
        ok: true,
        body: {
            owner: {
                user_id: review.user_id,
                email: ownerInfo?.email ?? null,
                display_name:
                    profileByUserId.get(review.user_id as string) ?? null,
            },
            members: sharedWith.map((email) => {
                const u = userByEmail.get(email);
                const display_name = u
                    ? (profileByUserId.get(u.id) ?? null)
                    : null;
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
        .select("id, user_id, project_id")
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
                markdown =
                    docActive.file_type === "pdf"
                        ? await extractPdfMarkdown(buf)
                        : await extractDocxMarkdown(buf);
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

// ---------------------------------------------------------------------------
// Streaming prepare guards (non-streaming work before the SSE loop)
// ---------------------------------------------------------------------------

export type PreparedGenerate = {
    columns: Column[];
    cellMap: Map<string, Record<string, unknown>>;
    docs: Record<string, unknown>[];
    tabular_model: string;
    api_keys: UserApiKeys;
};

export async function prepareTabularGenerate(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<
    | { ok: true; data: PreparedGenerate }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "no_columns" }
    | { ok: false; kind: "missing_api_key"; missingKey: MissingApiKey }
> {
    const { reviewId, userId, userEmail } = args;

    const { data: review, error: reviewError } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (reviewError || !review) return { ok: false, kind: "not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "not_found" };

    const columns: Column[] = review.columns_config ?? [];
    if (columns.length === 0) return { ok: false, kind: "no_columns" };

    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);
    const cellMap = new Map<string, Record<string, unknown>>();
    for (const cell of cells ?? [])
        cellMap.set(`${cell.document_id}:${cell.column_index}`, cell);

    const docIds = [
        ...new Set((cells ?? []).map((c: any) => c.document_id)),
    ] as string[];
    const allowedDocIds = new Set(
        await filterAccessibleDocumentIds(docIds, userId, userEmail, db),
    );
    let docs: Record<string, unknown>[] = [];
    if (docIds.length > 0) {
        const filteredIds = docIds.filter((id: string) =>
            allowedDocIds.has(id),
        );
        const { data } =
            filteredIds.length > 0
                ? await db
                      .from("documents")
                      .select("id, current_version_id")
                      .in("id", filteredIds)
                : { data: [] as Record<string, unknown>[] };
        docs = data ?? [];
    } else if (review.project_id) {
        const { data } = await db
            .from("documents")
            .select("id, current_version_id")
            .eq("project_id", review.project_id)
            .order("created_at", { ascending: true });
        docs = data ?? [];
    }
    await attachActiveVersionPaths(
        db,
        docs as {
            id: string;
            current_version_id?: string | null;
        }[],
    );

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) return { ok: false, kind: "missing_api_key", missingKey };

    return {
        ok: true,
        data: { columns, cellMap, docs, tabular_model, api_keys },
    };
}

export type PreparedChat = {
    tabularStore: TabularCellStore;
    apiMessages: unknown[];
    chatId: string | null;
    chatTitle: string | null;
    isFirstExchange: boolean;
    lastUserContent: string;
    reviewTitle: string | null;
    tabular_model: string;
    api_keys: UserApiKeys;
};

export async function prepareTabularChat(
    db: Db,
    args: {
        reviewId: string;
        userId: string;
        userEmail: string | undefined;
        messages: ChatMessage[];
        existingChatId?: string;
        lastUserContent: string;
    },
): Promise<
    | { ok: true; data: PreparedChat }
    | { ok: false; kind: "not_found" }
    | { ok: false; kind: "missing_api_key"; missingKey: MissingApiKey }
> {
    const { reviewId, userId, userEmail, messages, existingChatId, lastUserContent } =
        args;

    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("*")
        .eq("id", reviewId)
        .single();
    if (error || !review) return { ok: false, kind: "not_found" };
    const reviewAccess = await ensureReviewAccess(
        review,
        userId,
        userEmail,
        db,
    );
    if (!reviewAccess.ok) return { ok: false, kind: "not_found" };

    // Fetch all cells and documents for this review
    const { data: cells } = await db
        .from("tabular_cells")
        .select("*")
        .eq("review_id", reviewId);

    const docIds = [
        ...new Set((cells ?? []).map((c: any) => c.document_id as string)),
    ];
    let docs: {
        id: string;
        filename: string;
        current_version_id?: string | null;
    }[] = [];
    if (docIds.length > 0) {
        const { data } = await db
            .from("documents")
            .select("id, current_version_id")
            .in("id", docIds)
            .order("created_at", { ascending: true });
        const attachedDocs = (data ?? []) as {
            id: string;
            current_version_id?: string | null;
            filename?: string | null;
        }[];
        await attachActiveVersionPaths(db, attachedDocs);
        docs = attachedDocs.map((doc) => ({
            ...doc,
            filename:
                (typeof doc.filename === "string" && doc.filename.trim()) ||
                "Untitled document",
        }));
    }

    const sortedColumns = (
        (review.columns_config ?? []) as { index: number; name: string }[]
    ).sort((a, b) => a.index - b.index);

    const tabularStore: TabularCellStore = {
        columns: sortedColumns,
        documents: docs,
        cells: new Map(
            (cells ?? []).map((c: any) => [
                `${c.column_index}:${c.document_id}`,
                parseCellContent(c.content),
            ]),
        ),
    };

    const { tabular_model, api_keys } = await getUserModelSettings(userId, db);
    const missingKey = missingModelApiKey(tabular_model, api_keys);
    if (missingKey) return { ok: false, kind: "missing_api_key", missingKey };

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
            content: lastUserContent,
        });
    }

    const apiMessages = buildTabularMessages(
        messages,
        tabularStore,
        review.title || "Untitled Review",
    );

    return {
        ok: true,
        data: {
            tabularStore,
            apiMessages,
            chatId,
            chatTitle,
            isFirstExchange,
            lastUserContent,
            reviewTitle: review.title ?? null,
            tabular_model,
            api_keys,
        },
    };
}

// ---------------------------------------------------------------------------
// Chat metadata
// ---------------------------------------------------------------------------

export async function listTabularChats(
    db: Db,
    args: { reviewId: string; userId: string; userEmail: string | undefined },
): Promise<{ ok: true; chats: unknown[] } | { ok: false }> {
    const { reviewId, userId, userEmail } = args;

    // Verify access (owner or shared-project member).
    const { data: review, error } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id")
        .eq("id", reviewId)
        .single();
    if (error || !review) return { ok: false };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false };

    // Show every member's chats for the review (collaborative), not just
    // the requester's. Per-chat access is gated above by review access.
    const { data: chats } = await db
        .from("tabular_review_chats")
        .select("id, title, created_at, updated_at, user_id")
        .eq("review_id", reviewId)
        .order("updated_at", { ascending: false });

    return { ok: true, chats: chats ?? [] };
}

export async function deleteTabularChat(
    db: Db,
    args: { chatId: string; userId: string },
): Promise<{ ok: true } | { ok: false; detail: string }> {
    const { chatId, userId } = args;
    // Owner-only delete — sibling collaborators shouldn't be able to wipe
    // each other's threads.
    const { error } = await db
        .from("tabular_review_chats")
        .delete()
        .eq("id", chatId)
        .eq("user_id", userId);
    if (error) return { ok: false, detail: error.message };
    return { ok: true };
}

export async function getTabularChatMessages(
    db: Db,
    args: {
        reviewId: string;
        chatId: string;
        userId: string;
        userEmail: string | undefined;
    },
): Promise<
    | { ok: true; messages: unknown[] }
    | { ok: false; kind: "review_not_found" }
    | { ok: false; kind: "chat_not_found" }
> {
    const { reviewId, chatId, userId, userEmail } = args;

    const { data: review } = await db
        .from("tabular_reviews")
        .select("id, user_id, project_id")
        .eq("id", reviewId)
        .single();
    if (!review) return { ok: false, kind: "review_not_found" };
    const access = await ensureReviewAccess(review, userId, userEmail, db);
    if (!access.ok) return { ok: false, kind: "review_not_found" };

    const { data: chat, error: chatError } = await db
        .from("tabular_review_chats")
        .select("id, review_id")
        .eq("id", chatId)
        .single();
    if (chatError || !chat || chat.review_id !== reviewId)
        return { ok: false, kind: "chat_not_found" };

    const { data: messages } = await db
        .from("tabular_review_chat_messages")
        .select("id, role, content, annotations, created_at")
        .eq("chat_id", chatId)
        .order("created_at", { ascending: true });

    return { ok: true, messages: messages ?? [] };
}

// `buildTabularContext` is retained for parity with the pre-refactor module
// (it was defined but unused there); keep it available for future callers.
void buildTabularContext;
