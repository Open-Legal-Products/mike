/**
 * Chat context builders.
 *
 * Extracted from chatTools.ts to keep that file focused on tool execution.
 * Importing from chatTools.ts still works — it re-exports everything here.
 *
 * Contents:
 *   - generateSpotlightNonce  — per-request nonce for prompt-injection spotlighting
 *   - buildMessages           — formats ChatMessage[] into the LLM message array
 *   - enrichWithPriorEvents   — appends tool-activity summary to the prior assistant turn
 *   - buildDocContext          — resolves file attachments → DocIndex + DocStore
 *   - buildProjectDocContext  — same for project-scoped chats
 *   - buildWorkflowStore      — loads built-in + user + shared workflows
 */

import crypto from "crypto";
import {
    attachActiveVersionPaths,
} from "./documentVersions";
import { createServerSupabase } from "./supabase";
import { logger } from "./logger";
import { buildLawLibrarySystemPrompt } from "./lawLibraries";
import {
    SYSTEM_PROMPT,
    type ChatMessage,
    type DocIndex,
    type DocStore,
    type WorkflowStore,
} from "./chatToolDefs";

// ---------------------------------------------------------------------------
// Prompt-injection spotlighting helpers
// ---------------------------------------------------------------------------

/**
 * Generates a random 16-byte hex nonce for use as the spotlighting fence.
 * A fresh nonce per request means injected content cannot predict the tag it
 * would need to forge in order to escape the <untrusted-content> block.
 */
export function generateSpotlightNonce(): string {
    return crypto.randomBytes(16).toString("hex");
}

/**
 * Wraps untrusted user-controlled text in a nonce-fenced tag.
 * The LLM is instructed (in SYSTEM_PROMPT) to treat everything inside these
 * tags as data, not as instructions — a technique called "spotlighting".
 */
function spotlight(text: string, nonce: string): string {
    return `<untrusted-content nonce="${nonce}">\n${text}\n</untrusted-content>`;
}

// ---------------------------------------------------------------------------
// Message builder
// ---------------------------------------------------------------------------

/**
 * Formats ChatMessage[] into the LLM wire format (system + user/assistant
 * turns).  The system prompt is extended with any registered law library
 * plugin fragments, plus the optional per-call systemPromptExtra.
 */
export function buildMessages(
    messages: ChatMessage[],
    docAvailability: {
        doc_id: string;
        filename: string;
        folder_path?: string;
    }[],
    systemPromptExtra?: string,
    docIndex?: DocIndex,
    nonce?: string,
) {
    const formatted: unknown[] = [];
    let systemContent = buildLawLibrarySystemPrompt(SYSTEM_PROMPT);

    if (systemPromptExtra) {
        systemContent += `\n\n${systemPromptExtra.trim()}`;
    }

    if (docAvailability.length) {
        systemContent += "\n\n---\nAVAILABLE DOCUMENTS:\n";
        for (const doc of docAvailability) {
            // Filenames are user-controlled and may contain injected text.
            // Wrap in the spotlight fence so the LLM treats them as data.
            const rawLabel = doc.folder_path
                ? `${doc.folder_path} / ${doc.filename}`
                : doc.filename;
            const label = nonce ? spotlight(rawLabel, nonce) : rawLabel;
            systemContent += `- ${doc.doc_id}: ${label}\n`;
        }
        systemContent +=
            "\nYou do NOT retain document content between conversation turns. You MUST call read_document (or fetch_documents) at the start of every response that involves a document's content, even if you have read it in a previous turn. Failure to do so will result in hallucinated or stale content.\n---\n";
    }
    formatted.push({ role: "system", content: systemContent });

    // Map document_id (UUID) → current-turn doc_id slug, so when we
    // inline a user attachment we hand the model the same handle it
    // would use to call read_document / fetch_documents.
    const slugByDocumentId = new Map<string, string>();
    if (docIndex) {
        for (const [slug, info] of Object.entries(docIndex)) {
            if (info.document_id) slugByDocumentId.set(info.document_id, slug);
        }
    }

    for (const msg of messages) {
        let content = msg.content ?? "";
        if (msg.role === "user" && msg.workflow) {
            // Workflow titles are user-controlled; spotlight them.
            const title = nonce
                ? spotlight(msg.workflow.title, nonce)
                : msg.workflow.title;
            content = `[Workflow: ${title} (id: ${msg.workflow.id})]\n\n${content}`;
        }
        if (msg.role === "user" && msg.files?.length) {
            const lines = msg.files.map((f) => {
                const slug = f.document_id
                    ? slugByDocumentId.get(f.document_id)
                    : undefined;
                // Filenames are user-controlled; spotlight them.
                const fname = nonce ? spotlight(f.filename, nonce) : f.filename;
                return slug ? `- ${slug}: ${fname}` : `- ${fname}`;
            });
            content = `[The user attached the following document(s) to this message:\n${lines.join("\n")}]\n\n${content}`;
        }
        formatted.push({ role: msg.role, content });
    }
    return formatted;
}

// ---------------------------------------------------------------------------
// Prior-event enrichment
// ---------------------------------------------------------------------------

/**
 * Appends a tool-activity summary to the most recent assistant message so
 * the model can see what it just did (read / create / edit / workflow
 * applied) in the prior turn — otherwise it only sees its own prose and
 * forgets which docs it touched, which leads to e.g. re-generating a doc
 * that already exists.
 *
 * Doc references use the *current-turn* `doc_id` slug (looked up by
 * matching the event's stored `document_id` against this turn's freshly
 * built `docIndex`), since slugs are reassigned every turn and the old
 * slug from the prior turn would be meaningless. Falls back to filename
 * only if the doc is no longer in the index (deleted, scope changed).
 */
export async function enrichWithPriorEvents(
    messages: ChatMessage[],
    chatId: string | null | undefined,
    db: ReturnType<typeof createServerSupabase>,
    docIndex: DocIndex,
): Promise<ChatMessage[]> {
    if (!chatId) return messages;
    const { data: rows } = await db
        .from("chat_messages")
        .select("content, created_at")
        .eq("chat_id", chatId)
        .eq("role", "assistant")
        .order("created_at", { ascending: false })
        .limit(1);

    const lastRow = rows?.[0] as { content?: unknown } | undefined;
    const content = lastRow?.content;
    if (!Array.isArray(content)) return messages;

    const slugByDocumentId = new Map<string, string>();
    for (const [slug, info] of Object.entries(docIndex)) {
        if (info.document_id) slugByDocumentId.set(info.document_id, slug);
    }
    const refFor = (documentId: unknown, filename: unknown) => {
        const slug =
            typeof documentId === "string"
                ? slugByDocumentId.get(documentId)
                : undefined;
        return slug ? `${slug} ("${filename}")` : `"${filename}"`;
    };

    const lines: string[] = [];
    for (const ev of content as Record<string, unknown>[]) {
        if (ev?.type === "doc_created") {
            lines.push(
                `- generate_docx → ${refFor(ev.document_id, ev.filename)}`,
            );
        } else if (ev?.type === "doc_edited") {
            lines.push(
                `- edit_document → ${refFor(ev.document_id, ev.filename)}`,
            );
        } else if (ev?.type === "doc_replicated") {
            lines.push(
                `- replicate_document → ${refFor(ev.document_id, ev.filename)}`,
            );
        } else if (ev?.type === "doc_read") {
            lines.push(`- read_document(${refFor(ev.document_id, ev.filename)})`);
        } else if (ev?.type === "workflow_applied") {
            lines.push(`- read_workflow(${ev.workflow_id}) → "${ev.title}"`);
        }
    }
    if (lines.length === 0) return messages;
    const summary = `\n\n[Tool activity in your previous turn]\n${lines.join("\n")}`;

    // Find the index of the last assistant message and attach the
    // summary there only.
    let lastAssistantIdx = -1;
    for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "assistant") {
            lastAssistantIdx = i;
            break;
        }
    }
    if (lastAssistantIdx < 0) return messages;
    const enriched = messages.slice();
    const target = enriched[lastAssistantIdx];
    enriched[lastAssistantIdx] = {
        ...target,
        content: (target.content ?? "") + summary,
    };
    return enriched;
}

// ---------------------------------------------------------------------------
// Document context builders
// ---------------------------------------------------------------------------

/**
 * Resolves the file attachments across all chat messages into a
 * DocIndex + DocStore that the tool handlers can look up by slug.
 */
export async function buildDocContext(
    messages: ChatMessage[],
    userId: string,
    db: ReturnType<typeof createServerSupabase>,
    chatId?: string | null,
): Promise<{ docIndex: DocIndex; docStore: DocStore }> {
    const docIndex: DocIndex = {};
    const docStore: DocStore = new Map();

    const documentIds = new Set<string>();
    for (const m of messages) {
        for (const f of m.files ?? []) {
            if (f.document_id) documentIds.add(f.document_id);
        }
    }

    // Also pull in document_ids from prior assistant events in this chat —
    // generated docs (generate_docx) and tracked-change edits (edit_document)
    // aren't attached to user messages as files, so they only live in the
    // assistant's `doc_created` / `doc_edited` events. Without this sweep
    // the model loses access to generated docs after the turn that created
    // them, and can't call edit_document / read_document on them.
    if (chatId) {
        const { data: rows } = await db
            .from("chat_messages")
            .select("content")
            .eq("chat_id", chatId)
            .eq("role", "assistant");
        for (const row of rows ?? []) {
            const content = (row as { content?: unknown }).content;
            if (!Array.isArray(content)) continue;
            for (const ev of content as Record<string, unknown>[]) {
                if (
                    (ev?.type === "doc_created" || ev?.type === "doc_edited") &&
                    typeof ev.document_id === "string"
                ) {
                    documentIds.add(ev.document_id);
                }
            }
        }
    }

    const ids = [...documentIds];
    if (ids.length > 0) {
        const { data: docs } = await db
            .from("documents")
            .select("id, filename, file_type, current_version_id, status")
            .in("id", ids)
            .eq("user_id", userId)
            .eq("status", "ready");

        const docList = (docs ?? []) as unknown as {
            id: string;
            filename: string;
            file_type: string;
            current_version_id?: string | null;
            active_version_number?: number | null;
            storage_path?: string | null;
        }[];
        await attachActiveVersionPaths(db, docList);
        for (let i = 0; i < docList.length; i++) {
            const doc = docList[i];
            if (!doc.storage_path) continue;
            const docLabel = `doc-${i}`;
            docIndex[docLabel] = {
                document_id: doc.id,
                filename: doc.filename,
                version_id: doc.current_version_id ?? null,
                version_number: doc.active_version_number ?? null,
            };
            docStore.set(docLabel, {
                storage_path: doc.storage_path,
                file_type: doc.file_type,
                filename: doc.filename,
            });
        }
    }

    logger.debug(
        {
            docs: Object.entries(docIndex).map(([label, info]) => ({
                label,
                filename: info.filename,
                document_id: info.document_id,
            })),
        },
        "[buildDocContext] available docs",
    );
    return { docIndex, docStore };
}

/**
 * Project-scoped variant of buildDocContext.  Loads all documents
 * belonging to the project (not just those attached to messages) and
 * resolves their subfolder paths for display in the system prompt.
 */
export async function buildProjectDocContext(
    projectId: string,
    _userId: string,
    db: ReturnType<typeof createServerSupabase>,
): Promise<{
    docIndex: DocIndex;
    docStore: DocStore;
    folderPaths: Map<string, string>;
}> {
    const docIndex: DocIndex = {};
    const docStore: DocStore = new Map();

    const [{ data: docs }, { data: folders }] = await Promise.all([
        db
            .from("documents")
            .select(
                "id, filename, file_type, current_version_id, status, folder_id",
            )
            .eq("project_id", projectId)
            .eq("status", "ready")
            .order("created_at", { ascending: true }),
        db
            .from("project_subfolders")
            .select("id, name, parent_folder_id")
            .eq("project_id", projectId),
    ]);
    const docList = (docs ?? []) as unknown as {
        id: string;
        filename: string;
        file_type: string;
        current_version_id?: string | null;
        active_version_number?: number | null;
        folder_id?: string | null;
        storage_path?: string | null;
    }[];
    await attachActiveVersionPaths(db, docList);

    // Build folder id → full path map
    const folderMap = new Map<
        string,
        { name: string; parent_folder_id: string | null }
    >();
    for (const f of folders ?? [])
        folderMap.set(f.id, {
            name: f.name,
            parent_folder_id: f.parent_folder_id,
        });

    function resolvePath(folderId: string | null): string {
        if (!folderId) return "";
        const parts: string[] = [];
        let cur: string | null = folderId;
        while (cur) {
            const f = folderMap.get(cur);
            if (!f) break;
            parts.unshift(f.name);
            cur = f.parent_folder_id;
        }
        return parts.join(" / ");
    }

    const folderPaths = new Map<string, string>(); // doc label → folder path

    for (let i = 0; i < docList.length; i++) {
        const doc = docList[i];
        if (!doc.storage_path) continue;
        const docLabel = `doc-${i}`;
        docIndex[docLabel] = {
            document_id: doc.id,
            filename: doc.filename,
            version_id: doc.current_version_id ?? null,
            version_number: doc.active_version_number ?? null,
        };
        docStore.set(docLabel, {
            storage_path: doc.storage_path,
            file_type: doc.file_type,
            filename: doc.filename,
        });
        const folderPath = resolvePath(doc.folder_id ?? null);
        if (folderPath) folderPaths.set(docLabel, folderPath);
    }

    logger.debug(
        {
            docs: Object.entries(docIndex).map(([label, info]) => ({
                label,
                filename: info.filename,
                document_id: info.document_id,
                folder: folderPaths.get(label) ?? null,
            })),
        },
        "[buildProjectDocContext] available docs",
    );
    return { docIndex, docStore, folderPaths };
}

// ---------------------------------------------------------------------------
// Workflow store builder
// ---------------------------------------------------------------------------

/**
 * Loads built-in workflows, user-owned assistant workflows, and any
 * workflows shared with the user's email into a single keyed map.
 */
export async function buildWorkflowStore(
    userId: string,
    userEmail: string | null | undefined,
    db: ReturnType<typeof createServerSupabase>,
): Promise<WorkflowStore> {
    const { BUILTIN_WORKFLOWS } = await import("./builtinWorkflows");
    const store: WorkflowStore = new Map();
    const normalizedUserEmail = (userEmail ?? "").trim().toLowerCase();

    // Seed built-ins first
    for (const wf of BUILTIN_WORKFLOWS) {
        store.set(wf.id, { title: wf.title, prompt_md: wf.prompt_md });
    }

    // Then overlay user-owned assistant workflows.
    const { data: workflows } = await db
        .from("workflows")
        .select("id, title, prompt_md")
        .eq("user_id", userId)
        .eq("type", "assistant");
    for (const wf of workflows ?? []) {
        if (wf.prompt_md) {
            store.set(wf.id, { title: wf.title, prompt_md: wf.prompt_md });
        }
    }

    // Shared assistant workflows must also be readable by workflow tools.
    if (normalizedUserEmail) {
        const { data: shares } = await db
            .from("workflow_shares")
            .select("workflow_id")
            .eq("shared_with_email", normalizedUserEmail);
        const sharedIds = [
            ...new Set((shares ?? []).map((share: any) => share.workflow_id)),
        ];
        if (sharedIds.length > 0) {
            const { data: sharedWorkflows } = await db
                .from("workflows")
                .select("id, title, prompt_md")
                .in("id", sharedIds)
                .eq("type", "assistant");
            for (const wf of sharedWorkflows ?? []) {
                if (wf.prompt_md) {
                    store.set(wf.id, {
                        title: wf.title,
                        prompt_md: wf.prompt_md,
                    });
                }
            }
        }
    }
    return store;
}
