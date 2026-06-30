// Business logic + data-access for the project-chat module.
//
// Service layer behind projectChat.routes.ts. Takes an explicit Supabase client
// (`db`) plus request-derived primitives, does the pre-stream DB orchestration,
// and RETURNS the prepared data (or a typed error). It never touches req/res.
//
// IMPORTANT: the SSE streaming loop (credit reserve/refund, header flush,
// runLLMStream, abort handling, assistant-message persistence) stays in the
// route — its ordering is delicate. Only the pre-stream preparation lives here.

import { createServerSupabase } from "../../lib/supabase";
import {
    buildProjectDocContext,
    buildMessages,
    buildWorkflowStore,
    enrichWithPriorEvents,
    generateSpotlightNonce,
    spotlight,
    type ChatMessage,
} from "../../lib/chatTools";
import { COURTLISTENER_SYSTEM_PROMPT } from "../../lib/legalSourcesTools/courtlistenerTools";
import { getUserModelSettings } from "../../lib/userSettings";
import { checkProjectAccess } from "../../lib/access";

type Db = ReturnType<typeof createServerSupabase>;

type DocRef = { filename: string; document_id: string };

export const PROJECT_SYSTEM_PROMPT_EXTRA = `PROJECT CONTEXT:
You are operating within a project folder that contains a collection of legal documents the user has organised for a single matter. The user's questions will usually refer to one or more documents in this project — your job is to find the relevant files to work on. Use list_documents to see what is available and fetch_documents / read_document to pull in any documents you need before answering.

A document may currently be displayed in the user's side panel; when provided, treat it as context for the user's likely focus, but do NOT assume it is the only or definitive document the user is asking about. If the request could apply to other files in the project, identify and read those as well. Prefer coverage across the relevant project documents over an over-narrow reading of only the displayed one.

REPLICATING A DOCUMENT:
When the user wants to use an existing project document as a starting point for a new file (e.g. "use this NDA as a template", "make me a copy of the SOW so I can edit it", "duplicate this and adapt it for company X"), call the replicate_document tool with the source doc_id. This creates a byte-for-byte copy as a new project document, returns a fresh doc_id slug, and shows a download/open card in the UI. Then call edit_document on the returned slug to make the user's requested changes — do NOT call generate_docx for cases where the user clearly wants the existing document's structure and formatting preserved.`;

export type PreparedProjectChatStream = {
    chatId: string;
    chatTitle: string | null;
    lastUser: ChatMessage | undefined;
    docIndex: Awaited<ReturnType<typeof buildProjectDocContext>>["docIndex"];
    docStore: Awaited<ReturnType<typeof buildProjectDocContext>>["docStore"];
    apiMessages: ReturnType<typeof buildMessages>;
    workflowStore: Awaited<ReturnType<typeof buildWorkflowStore>>;
    legalResearchUs: boolean;
    nonce: string;
};

export async function prepareProjectChatStream(
    db: Db,
    args: {
        userId: string;
        userEmail: string | undefined;
        projectId: string;
        messages: ChatMessage[];
        chatId: string | null;
        displayed_doc?: DocRef;
        attached_documents?: DocRef[];
        documentContext?: string;
    },
): Promise<
    | { ok: true; prepared: PreparedProjectChatStream }
    | { ok: false; status: number; code: string; detail: string }
> {
    const { userId, userEmail, projectId, messages } = args;

    // Verify the user has access to the project (owner or shared member).
    const projectAccess = await checkProjectAccess(
        projectId,
        userId,
        userEmail,
        db,
    );
    if (!projectAccess.ok)
        return {
            ok: false,
            status: 404,
            code: "NOT_FOUND",
            detail: "Project not found",
        };

    let chatId = args.chatId;
    let chatTitle: string | null = null;

    if (chatId) {
        const { data: existing } = await db
            .from("chats")
            .select("id, title, project_id")
            .eq("id", chatId)
            .single();
        const canUse = !!existing && existing.project_id === projectId;
        if (!canUse) chatId = null;
        else chatTitle = existing!.title;
    }

    if (!chatId) {
        const { data: newChat, error } = await db
            .from("chats")
            .insert({ user_id: userId, project_id: projectId })
            .select("id, title")
            .single();
        if (error || !newChat)
            return {
                ok: false,
                status: 500,
                code: "INTERNAL_ERROR",
                detail: "Failed to create chat",
            };
        chatId = newChat.id as string;
        chatTitle = newChat.title;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    if (lastUser) {
        await db.from("chat_messages").insert({
            chat_id: chatId,
            role: "user",
            content: lastUser.content,
            files: lastUser.files ?? null,
            workflow: lastUser.workflow ?? null,
        });
    }

    const { docIndex, docStore, folderPaths } = await buildProjectDocContext(
        projectId,
        userId,
        db,
    );
    const docAvailability = Object.entries(docIndex).map(([doc_id, info]) => ({
        doc_id,
        filename: info.filename,
        folder_path: folderPaths.get(doc_id),
    }));

    const enrichedMessages = await enrichWithPriorEvents(
        messages,
        chatId,
        db,
        docIndex,
    );
    const messagesForLLM: ChatMessage[] = args.displayed_doc
        ? enrichedMessages.map((m, i) => {
              if (i !== enrichedMessages.length - 1 || m.role !== "user")
                  return m;
              return {
                  ...m,
                  content: `${m.content}\n\ndisplayed_doc: ${args.displayed_doc!.filename}, displayed_doc_id: ${args.displayed_doc!.document_id}`,
              };
          })
        : enrichedMessages;

    // The user-attached docs for this turn (dragged into / picked from
    // the chat input) come in as a request-level field. Surface them in
    // the system prompt with the current-turn doc_id slugs so the model
    // knows which docs the user is highlighting *now*, distinct from
    // the broader project doc list.
    let systemPromptExtra = PROJECT_SYSTEM_PROMPT_EXTRA;
    if (args.attached_documents?.length) {
        const slugByDocumentId = new Map<string, string>();
        for (const [slug, info] of Object.entries(docIndex)) {
            if (info.document_id)
                slugByDocumentId.set(info.document_id, slug);
        }
        const lines = args.attached_documents.map((d) => {
            const slug = slugByDocumentId.get(d.document_id);
            return slug ? `- ${slug}: ${d.filename}` : `- ${d.filename}`;
        });
        systemPromptExtra += `\n\nUSER-ATTACHED DOCUMENTS FOR THIS TURN:\nThe user has attached the following document(s) directly to their latest message. Treat these as the primary focus of the request unless their message clearly says otherwise.\n${lines.join("\n")}`;
    }

    const nonce = generateSpotlightNonce();

    // Plain-text Word document body from the Office.js add-in, appended to the
    // project system context so the model can reason over the user's open file.
    // User-controlled, so it MUST be nonce-fenced via spotlight() (a
    // prompt-injection vector). Runtime-checked (a non-string would throw on
    // .trim()) and capped so an oversized body can't blow past the context
    // window / token budget.
    const MAX_DOCUMENT_CONTEXT_CHARS = 200_000;
    const docContext =
        typeof args.documentContext === "string"
            ? args.documentContext.trim()
            : "";
    if (docContext) {
        systemPromptExtra += `\n\nThe user is working in Microsoft Word. The text below is the body of their active document:\n${spotlight(docContext.slice(0, MAX_DOCUMENT_CONTEXT_CHARS), nonce)}`;
    }
    // apiKeys is fetched in the route via getUserApiKeys alongside the credit
    // check; here we only need upstream's legal_research_us flag for the stream.
    const { legal_research_us: legalResearchUs } = await getUserModelSettings(
        userId,
        db,
    );
    // Pair the CourtListener guidance with includeResearchTools in the route so
    // the model gets both the case-law tools and the instructions for using them.
    if (legalResearchUs) {
        systemPromptExtra += `\n\n${COURTLISTENER_SYSTEM_PROMPT}`;
    }
    const apiMessages = buildMessages(
        messagesForLLM,
        docAvailability,
        systemPromptExtra,
        docIndex,
        nonce,
    );

    const workflowStore = await buildWorkflowStore(userId, userEmail, db);

    return {
        ok: true,
        prepared: {
            chatId,
            chatTitle,
            lastUser,
            docIndex,
            docStore,
            apiMessages,
            workflowStore,
            legalResearchUs,
            nonce,
        },
    };
}
