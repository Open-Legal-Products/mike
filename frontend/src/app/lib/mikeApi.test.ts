import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import type { AssistantEvent, Chat } from "@/app/components/shared/types";

// mikeApi resolves the auth header through the module-level Supabase client,
// so swap it for a controllable session before the module under test loads.
const { getSessionMock } = vi.hoisted(() => ({
    getSessionMock: vi.fn(),
}));
vi.mock("@/app/lib/supabase", () => ({
    supabase: { auth: { getSession: getSessionMock } },
}));

import {
    MikeApiError,
    addDocumentToProject,
    clearTabularCells,
    copyDocumentVersionFromDocument,
    createChat,
    createLibraryFolder,
    createMcpConnector,
    createProject,
    createProjectFolder,
    createTabularReview,
    createWorkflow,
    deleteAccount,
    deleteAllChats,
    deleteAllProjects,
    deleteAllTabularReviews,
    deleteChat,
    deleteDocument,
    deleteDocumentVersion,
    deleteLibraryFolder,
    deleteMcpConnector,
    deleteProject,
    deleteProjectFolder,
    deleteTabularChat,
    deleteTabularReview,
    deleteWorkflow,
    deleteWorkflowShare,
    downloadDocumentsZip,
    exportAccountData,
    exportChatData,
    exportTabularReviewsData,
    generateChatTitle,
    generateTabularColumnPrompt,
    getApiKeyStatus,
    getChat,
    getCourtlistenerOpinions,
    getDocumentUrl,
    getLibrary,
    getMcpConnector,
    getOllamaModels,
    getProject,
    getProjectPeople,
    getTabularChatMessages,
    getTabularChats,
    getTabularReview,
    getTabularReviewPeople,
    getUserProfile,
    getWorkflow,
    hideWorkflow,
    isMfaRequiredError,
    listChats,
    listDocumentVersions,
    listHiddenWorkflows,
    listMcpConnectors,
    listProjectChats,
    listProjects,
    listStandaloneDocuments,
    listTabularReviewIds,
    listTabularReviews,
    listWorkflowShares,
    listWorkflows,
    lookupUserByEmail,
    mapTRMessages,
    moveDocumentToFolder,
    moveLibraryDocument,
    moveLibraryFolder,
    moveSubfolderToFolder,
    openSourceWorkflow,
    refreshMcpConnectorTools,
    regenerateTabularCell,
    renameChat,
    renameDocumentVersion,
    renameLibraryDocument,
    renameLibraryFolder,
    renameProjectDocument,
    renameProjectFolder,
    renameTabularChat,
    replaceDocumentVersionFile,
    saveApiKey,
    setMcpToolEnabled,
    shareWorkflow,
    startMcpConnectorOAuth,
    streamChat,
    streamProjectChat,
    streamTabularChat,
    streamTabularGeneration,
    unhideWorkflow,
    updateMcpConnector,
    updateProject,
    updateTabularReview,
    updateUserMfaOnLogin,
    updateUserProfile,
    updateWorkflow,
    uploadDocumentVersion,
    uploadLibraryDocument,
    uploadProjectDocument,
    uploadReviewDocument,
    uploadStandaloneDocument,
} from "./mikeApi";

const fetchMock = vi.fn();

const withSession = (token: string | null) => {
    getSessionMock.mockResolvedValue({
        data: {
            session: token ? { access_token: token } : null,
        },
    });
};

const jsonResponse = (body: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { "Content-Type": "application/json" },
        ...init,
    });

/** Build a Response whose body is a real ReadableStream of the given chunks. */
const streamResponse = (chunks: string[]) => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(encoder.encode(chunk));
            }
            controller.close();
        },
    });
    return new Response(stream, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
    });
};

const readAll = async (response: Response) => {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
};

const lastFetchCall = () => {
    const call = fetchMock.mock.calls.at(-1);
    if (!call) throw new Error("fetch was not called");
    return { url: call[0] as string, init: call[1] as RequestInit };
};

beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    withSession("token-123");
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("MikeApiError / isMfaRequiredError", () => {
    it("carries status and code, defaulting code to null", () => {
        const withCode = new MikeApiError({
            message: "nope",
            status: 403,
            code: "mfa_verification_required",
        });
        expect(withCode.name).toBe("MikeApiError");
        expect(withCode.status).toBe(403);
        expect(withCode.code).toBe("mfa_verification_required");

        const withoutCode = new MikeApiError({ message: "nope", status: 500 });
        expect(withoutCode.code).toBeNull();
    });

    it("recognizes exactly the 403 + mfa_verification_required combination", () => {
        expect(
            isMfaRequiredError(
                new MikeApiError({
                    message: "x",
                    status: 403,
                    code: "mfa_verification_required",
                }),
            ),
        ).toBe(true);
        expect(
            isMfaRequiredError(
                new MikeApiError({ message: "x", status: 403, code: "other" }),
            ),
        ).toBe(false);
        expect(
            isMfaRequiredError(
                new MikeApiError({
                    message: "x",
                    status: 401,
                    code: "mfa_verification_required",
                }),
            ),
        ).toBe(false);
        expect(isMfaRequiredError(new Error("plain"))).toBe(false);
    });
});

describe("apiRequest plumbing (via thin wrappers)", () => {
    it("attaches the Supabase bearer token and JSON accept header", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ tier: "free" }));

        const profile = await getUserProfile();

        expect(profile).toEqual({ tier: "free" });
        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/user/profile");
        expect(init.cache).toBe("no-store");
        expect(init.headers).toMatchObject({
            Accept: "application/json",
            Authorization: "Bearer token-123",
        });
    });

    it("omits the Authorization header when there is no session", async () => {
        withSession(null);
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listProjects();

        const { init } = lastFetchCall();
        expect(
            (init.headers as Record<string, string>).Authorization,
        ).toBeUndefined();
    });

    it("appends ?include=documents when requested", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listProjects({ includeDocuments: true });

        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/projects?include=documents",
        );
    });

    it("returns undefined for 204 responses", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await expect(deleteAllChats()).resolves.toBeUndefined();
        expect(lastFetchCall().init.method).toBe("DELETE");
    });

    it("returns undefined when content-length is 0", async () => {
        fetchMock.mockResolvedValue(
            new Response(null, {
                status: 200,
                headers: { "content-length": "0" },
            }),
        );

        await expect(deleteAllChats()).resolves.toBeUndefined();
    });

    it("maps a JSON error body to a MikeApiError with code and detail", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse(
                { detail: "MFA required", code: "mfa_verification_required" },
                { status: 403 },
            ),
        );

        const error = await getUserProfile().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MikeApiError);
        const apiError = error as MikeApiError;
        expect(apiError.status).toBe(403);
        expect(apiError.code).toBe("mfa_verification_required");
        expect(apiError.message).toBe("MFA required");
        expect(isMfaRequiredError(apiError)).toBe(true);
    });

    it("falls back to a generic message when detail is not a string", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ detail: { nested: true } }, { status: 500 }),
        );

        await expect(getUserProfile()).rejects.toMatchObject({
            status: 500,
            code: null,
            message: "API error: 500",
        });
    });

    it("uses the raw body text for non-JSON error responses", async () => {
        fetchMock.mockResolvedValue(
            new Response("upstream exploded", { status: 502 }),
        );

        await expect(getUserProfile()).rejects.toMatchObject({
            status: 502,
            message: "upstream exploded",
        });
    });

    it("synthesizes a message when the error body is empty", async () => {
        fetchMock.mockResolvedValue(new Response("", { status: 503 }));

        await expect(getUserProfile()).rejects.toMatchObject({
            status: 503,
            message: "API error: 503",
        });
    });

    it("encodes query parameters (lookupUserByEmail, listChats)", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ exists: false }));
        await lookupUserByEmail("a+b@example.com");
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/user/lookup?email=a%2Bb%40example.com",
        );

        fetchMock.mockResolvedValue(jsonResponse([]));
        await listChats({ limit: 5 });
        expect(lastFetchCall().url).toBe("http://localhost:3001/chat?limit=5");
    });
});

describe("blob requests (exportAccountData)", () => {
    it("returns the blob and the filename from content-disposition", async () => {
        fetchMock.mockResolvedValue(
            new Response("zip-bytes", {
                status: 200,
                headers: {
                    "content-disposition": 'attachment; filename="export.zip"',
                },
            }),
        );

        const { blob, filename } = await exportAccountData();

        expect(filename).toBe("export.zip");
        expect(await blob.text()).toBe("zip-bytes");
    });

    it("parses unquoted filenames and returns null when absent", async () => {
        fetchMock.mockResolvedValue(
            new Response("x", {
                status: 200,
                headers: {
                    "content-disposition": "attachment; filename=data.zip",
                },
            }),
        );
        expect((await exportAccountData()).filename).toBe("data.zip");

        fetchMock.mockResolvedValue(new Response("x", { status: 200 }));
        expect((await exportAccountData()).filename).toBeNull();
    });

    it("throws a MikeApiError on failure", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ detail: "not allowed" }, { status: 403 }),
        );

        await expect(exportAccountData()).rejects.toMatchObject({
            status: 403,
            message: "not allowed",
        });
    });
});

describe("downloadDocumentsZip", () => {
    it("POSTs the document ids and returns the blob", async () => {
        fetchMock.mockResolvedValue(new Response("zip", { status: 200 }));

        const blob = await downloadDocumentsZip(["d1", "d2"]);

        expect(await blob.text()).toBe("zip");
        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/single-documents/download-zip");
        expect(JSON.parse(init.body as string)).toEqual({
            document_ids: ["d1", "d2"],
        });
    });

    it("throws a plain Error carrying the response text", async () => {
        fetchMock.mockResolvedValue(new Response("bad ids", { status: 400 }));

        await expect(downloadDocumentsZip(["x"])).rejects.toThrow("bad ids");
    });
});

describe("getChat message mapping", () => {
    const chat: Chat = {
        id: "c1",
        project_id: null,
        user_id: "u1",
        title: "T",
        created_at: "2026-01-01",
    };

    it("maps user messages, keeping files and workflow", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                chat,
                messages: [
                    {
                        id: "m1",
                        chat_id: "c1",
                        role: "user",
                        content: "hello",
                        files: [{ filename: "a.pdf", document_id: "d1" }],
                        workflow: { id: "w1", title: "NDA review" },
                        created_at: "2026-01-01",
                    },
                    {
                        id: "m2",
                        chat_id: "c1",
                        role: "user",
                        content: null,
                        created_at: "2026-01-01",
                    },
                ],
            }),
        );

        const { messages } = await getChat("c1");

        expect(messages[0]).toEqual({
            id: "m1",
            role: "user",
            content: "hello",
            files: [{ filename: "a.pdf", document_id: "d1" }],
            workflow: { id: "w1", title: "NDA review" },
        });
        // Non-string user content degrades to an empty string.
        expect(messages[1].content).toBe("");
    });

    it("joins assistant content events into content and preserves events", async () => {
        const events: AssistantEvent[] = [
            { type: "reasoning", text: "thinking" },
            { type: "content", text: "Part one. " },
            { type: "doc_read", filename: "a.pdf" },
            { type: "content", text: "Part two." },
        ];
        fetchMock.mockResolvedValue(
            jsonResponse({
                chat,
                messages: [
                    {
                        id: "m1",
                        chat_id: "c1",
                        role: "assistant",
                        content: events,
                        citations: [{ ref: 1 }],
                        created_at: "2026-01-01",
                    },
                ],
            }),
        );

        const { messages } = await getChat("c1");

        expect(messages[0].content).toBe("Part one. Part two.");
        expect(messages[0].events).toEqual(events);
        expect(messages[0].citations).toEqual([{ ref: 1 }]);
    });

    it("maps a legacy string assistant body to empty content without events", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({
                chat,
                messages: [
                    {
                        id: "m1",
                        chat_id: "c1",
                        role: "assistant",
                        content: "plain string",
                        created_at: "2026-01-01",
                    },
                ],
            }),
        );

        const { messages } = await getChat("c1");

        expect(messages[0].content).toBe("");
        expect(messages[0].events).toBeUndefined();
    });
});

describe("mapTRMessages", () => {
    it("maps user and assistant rows including annotations", () => {
        const events: AssistantEvent[] = [
            { type: "content", text: "Answer" },
        ];
        const mapped = mapTRMessages([
            {
                id: "m1",
                chat_id: "c1",
                role: "user",
                content: "question",
                created_at: "2026-01-01",
            },
            {
                id: "m2",
                chat_id: "c1",
                role: "assistant",
                content: events,
                annotations: [
                    {
                        type: "tabular_citation",
                        ref: 1,
                        col_index: 0,
                        row_index: 2,
                        col_name: "Term",
                        doc_name: "a.pdf",
                        quote: "12 months",
                    },
                ],
                created_at: "2026-01-01",
            },
        ]);

        expect(mapped).toEqual([
            { role: "user", content: "question" },
            {
                role: "assistant",
                content: "Answer",
                events,
                annotations: [
                    {
                        type: "tabular_citation",
                        ref: 1,
                        col_index: 0,
                        row_index: 2,
                        col_name: "Term",
                        doc_name: "a.pdf",
                        quote: "12 months",
                    },
                ],
            },
        ]);
    });

    it("degrades non-array assistant content to an empty string", () => {
        const mapped = mapTRMessages([
            {
                id: "m1",
                chat_id: "c1",
                role: "assistant",
                content: "legacy",
                created_at: "2026-01-01",
            },
        ]);
        expect(mapped[0]).toEqual({
            role: "assistant",
            content: "",
            events: undefined,
            annotations: undefined,
        });
    });
});

// ---------------------------------------------------------------------------
// Streaming endpoints. These are the frontend half of the SSE contract: the
// backend answers these POSTs with `data: <json>\n\n` server-sent-event lines,
// and these functions must hand the raw streaming Response through untouched
// so the consumer (useAssistantChat and the tabular loops) can parse it
// incrementally. Parsing itself is covered in
// src/app/hooks/useAssistantChat.sse.test.ts.
// ---------------------------------------------------------------------------

describe("streamChat", () => {
    it("POSTs with the SSE accept header and forwards the signal outside the body", async () => {
        fetchMock.mockResolvedValue(streamResponse([]));
        const controller = new AbortController();

        await streamChat({
            messages: [{ role: "user", content: "hi" }],
            chat_id: "c1",
            model: "gemini-3-flash-preview",
            reasoning_effort: "medium",
            signal: controller.signal,
        });

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/chat");
        expect(init.method).toBe("POST");
        expect(init.headers).toMatchObject({
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            Authorization: "Bearer token-123",
        });
        expect(init.signal).toBe(controller.signal);
        // The abort signal must not leak into the JSON payload.
        expect(JSON.parse(init.body as string)).toEqual({
            messages: [{ role: "user", content: "hi" }],
            chat_id: "c1",
            model: "gemini-3-flash-preview",
            reasoning_effort: "medium",
        });
    });

    it("returns the streaming Response body unconsumed", async () => {
        const chunks = [
            'data: {"type":"content_delta","text":"Hel',
            'lo"}\n\n',
        ];
        fetchMock.mockResolvedValue(streamResponse(chunks));

        const response = await streamChat({
            messages: [{ role: "user", content: "hi" }],
        });

        expect(response.bodyUsed).toBe(false);
        expect(await readAll(response)).toBe(chunks.join(""));
    });
});

describe("streamProjectChat", () => {
    it("targets the project chat route and strips projectId/signal from the body", async () => {
        fetchMock.mockResolvedValue(streamResponse([]));
        const controller = new AbortController();

        await streamProjectChat({
            projectId: "p1",
            messages: [{ role: "user", content: "hi" }],
            displayed_doc: { filename: "a.pdf", document_id: "d1" },
            reasoning_effort: "high",
            signal: controller.signal,
        });

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/projects/p1/chat");
        expect(init.signal).toBe(controller.signal);
        expect(JSON.parse(init.body as string)).toEqual({
            messages: [{ role: "user", content: "hi" }],
            displayed_doc: { filename: "a.pdf", document_id: "d1" },
            reasoning_effort: "high",
        });
    });
});

describe("streamTabularChat", () => {
    it("maps context fields into the payload and drops null chat_id", async () => {
        fetchMock.mockResolvedValue(streamResponse([]));

        await streamTabularChat(
            "r1",
            [{ role: "user", content: "summarize" }],
            null,
            undefined,
            {
                reviewTitle: "Leases",
                projectName: null,
                reasoningEffort: "low",
            },
        );

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1/chat");
        expect(JSON.parse(init.body as string)).toEqual({
            messages: [{ role: "user", content: "summarize" }],
            review_title: "Leases",
            reasoning_effort: "low",
        });
    });
});

describe("streamTabularGeneration", () => {
    it("POSTs to the generate route with auth only", async () => {
        fetchMock.mockResolvedValue(streamResponse([]));

        await streamTabularGeneration("r1");

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1/generate");
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ Authorization: "Bearer token-123" });
    });
});

// ---------------------------------------------------------------------------
// Tabular review listing. This is the query-building half of the paginated
// review list (PR #263 db-pagination + PR #274 folder grouping): the backend
// scopes, sorts, and pages entirely off these params, so a silently dropped
// or misnamed param means the UI shows the wrong rows, not an error.
// ---------------------------------------------------------------------------

describe("listTabularReviews", () => {
    it("requests the bare collection when no filters are given", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listTabularReviews();

        const { url, init } = lastFetchCall();
        // No stray "?" — the backend treats /tabular-review and
        // /tabular-review? the same, but the cache key would differ.
        expect(url).toBe("http://localhost:3001/tabular-review");
        expect(init.signal).toBeUndefined();
    });

    it("serializes every pagination knob and forwards the abort signal", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));
        const controller = new AbortController();

        await listTabularReviews("p1", {
            limit: 25,
            offset: 50,
            search: "lease agreements",
            sortKey: "updated_at",
            sortDirection: "desc",
            scope: "standalone",
            signal: controller.signal,
        });

        const { url, init } = lastFetchCall();
        expect(url).toBe(
            "http://localhost:3001/tabular-review" +
                "?project_id=p1&limit=25&offset=50&search=lease+agreements" +
                "&sort_key=updated_at&sort_direction=desc&scope=standalone",
        );
        // The signal lets the list screen cancel a stale page when the user
        // types a new search before the previous one resolves.
        expect(init.signal).toBe(controller.signal);
    });

    it('omits the scope param for "all" — the backend default', async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listTabularReviews(undefined, { scope: "all", limit: 10 });

        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/tabular-review?limit=10",
        );
    });
});

describe("listTabularReviewIds", () => {
    it("requests the bare id list when no filters are given", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listTabularReviewIds();

        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/tabular-review/ids",
        );
    });

    it("scopes ids by project, search, and scope so select-all matches the visible filter", async () => {
        fetchMock.mockResolvedValue(jsonResponse([{ id: "r1", user_id: "u1" }]));
        const controller = new AbortController();

        const ids = await listTabularReviewIds("p1", {
            search: "nda",
            scope: "in-project",
            signal: controller.signal,
        });

        expect(ids).toEqual([{ id: "r1", user_id: "u1" }]);
        const { url, init } = lastFetchCall();
        // Select-all-then-delete deletes whatever this returns; if the query
        // here is broader than the list query, users delete unseen reviews.
        expect(url).toBe(
            "http://localhost:3001/tabular-review/ids?project_id=p1&search=nda&scope=in-project",
        );
        expect(init.signal).toBe(controller.signal);
    });

    it('omits the scope param for "all"', async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listTabularReviewIds(undefined, { scope: "all" });

        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/tabular-review/ids",
        );
    });
});

describe("tabular review CRUD", () => {
    it("createTabularReview posts the folder grouping mode through unchanged", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ id: "r1" }));

        await createTabularReview({
            title: "Leases",
            document_ids: ["d1", "d2"],
            columns_config: [{ index: 0, name: "Term", prompt: "Find term" }],
            project_id: "p1",
            document_grouping: "folder",
        });

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({
            title: "Leases",
            document_ids: ["d1", "d2"],
            columns_config: [{ index: 0, name: "Term", prompt: "Find term" }],
            project_id: "p1",
            document_grouping: "folder",
        });
    });

    it("updateTabularReview PATCHes partial payloads without inventing fields", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ id: "r1" }));

        await updateTabularReview("r1", { document_grouping: "document" });

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1");
        expect(init.method).toBe("PATCH");
        expect(JSON.parse(init.body as string)).toEqual({
            document_grouping: "document",
        });
    });

    it("deleteTabularReview issues DELETE on the review resource", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await deleteTabularReview("r1");

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1");
        expect(init.method).toBe("DELETE");
    });

    it("generateTabularColumnPrompt forwards title and optional hints", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ prompt: "p", source: "preset" }),
        );

        const result = await generateTabularColumnPrompt("Termination", {
            format: "date",
            documentName: "lease.pdf",
            tags: ["real-estate"],
        });

        expect(result.source).toBe("preset");
        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/prompt");
        expect(JSON.parse(init.body as string)).toEqual({
            title: "Termination",
            format: "date",
            documentName: "lease.pdf",
            tags: ["real-estate"],
        });
    });
});

describe("uploadReviewDocument", () => {
    it("uploads into the project then appends the new id to the review", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ id: "new-doc" }))
            .mockResolvedValueOnce(jsonResponse({ id: "r1" }));
        const file = new File(["x"], "a.pdf");

        const uploaded = await uploadReviewDocument("r1", file, {
            projectId: "p1",
            documentIds: ["d1"],
            columnsConfig: [{ index: 0, name: "Term", prompt: "p" }],
        });

        expect(uploaded).toEqual({ id: "new-doc" });
        const [uploadCall, patchCall] = fetchMock.mock.calls;
        expect(uploadCall[0]).toBe("http://localhost:3001/projects/p1/documents");
        expect((uploadCall[1] as RequestInit).body).toBeInstanceOf(FormData);
        expect(patchCall[0]).toBe("http://localhost:3001/tabular-review/r1");
        // Existing ids must be preserved — the review would otherwise shrink
        // to just the newly uploaded document.
        expect(JSON.parse((patchCall[1] as RequestInit).body as string)).toEqual({
            columns_config: [{ index: 0, name: "Term", prompt: "p" }],
            document_ids: ["d1", "new-doc"],
        });
    });

    it("falls back to a standalone upload when the review has no project", async () => {
        fetchMock
            .mockResolvedValueOnce(jsonResponse({ id: "new-doc" }))
            .mockResolvedValueOnce(jsonResponse({ id: "r1" }));

        await uploadReviewDocument("r1", new File(["x"], "a.pdf"));

        const [uploadCall, patchCall] = fetchMock.mock.calls;
        expect(uploadCall[0]).toBe("http://localhost:3001/single-documents");
        // With no prior ids the review ends up with exactly the new document.
        expect(JSON.parse((patchCall[1] as RequestInit).body as string)).toEqual(
            { document_ids: ["new-doc"] },
        );
    });
});

describe("tabular review chats", () => {
    it("lists chats and fetches messages from the nested routes", async () => {
        fetchMock.mockImplementation(() => Promise.resolve(jsonResponse([])));

        await getTabularChats("r1");
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/tabular-review/r1/chats",
        );

        await getTabularChatMessages("r1", "c1");
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/tabular-review/r1/chats/c1/messages",
        );
    });

    it("renames via PATCH and deletes via DELETE on the chat resource", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await renameTabularChat("r1", "c1", "New title");
        let { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1/chats/c1");
        expect(init.method).toBe("PATCH");
        expect(JSON.parse(init.body as string)).toEqual({ title: "New title" });

        await deleteTabularChat("r1", "c1");
        ({ url, init } = lastFetchCall());
        expect(url).toBe("http://localhost:3001/tabular-review/r1/chats/c1");
        expect(init.method).toBe("DELETE");
    });

    it("includes chat_id but omits absent context in streamTabularChat", async () => {
        fetchMock.mockResolvedValue(streamResponse([]));

        await streamTabularChat("r1", [{ role: "user", content: "q" }], "c9");

        expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
            messages: [{ role: "user", content: "q" }],
            chat_id: "c9",
        });
    });
});

describe("tabular cell operations", () => {
    it("regenerateTabularCell posts the row/column address with snake_case keys", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ summary: "s", flag: "green", reasoning: "r" }),
        );

        const cell = await regenerateTabularCell("r1", "row-1", 2);

        expect(cell.flag).toBe("green");
        const { url, init } = lastFetchCall();
        expect(url).toBe(
            "http://localhost:3001/tabular-review/r1/regenerate-cell",
        );
        expect(JSON.parse(init.body as string)).toEqual({
            row_id: "row-1",
            column_index: 2,
        });
    });

    it("clearTabularCells posts the row ids to clear", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await clearTabularCells("r1", ["row-1", "row-2"]);

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1/clear-cells");
        expect(JSON.parse(init.body as string)).toEqual({
            row_ids: ["row-1", "row-2"],
        });
    });
});

// ---------------------------------------------------------------------------
// Multipart uploads. These bypass apiRequest (FormData must not get a JSON
// content type) and therefore have their own, weaker error contract: a plain
// Error carrying the raw response text instead of MikeApiError.
// ---------------------------------------------------------------------------

describe("multipart upload endpoints", () => {
    const file = new File(["pdf-bytes"], "a.pdf", { type: "application/pdf" });

    it("uploadLibraryDocument posts FormData with auth and no JSON content type", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ id: "d1" }));

        const doc = await uploadLibraryDocument("templates", file);

        expect(doc).toEqual({ id: "d1" });
        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/library/templates/documents");
        expect(init.method).toBe("POST");
        expect(init.body).toBeInstanceOf(FormData);
        expect((init.body as FormData).get("file")).toBeInstanceOf(File);
        // Setting Content-Type manually would break the multipart boundary.
        expect(init.headers).toEqual({ Authorization: "Bearer token-123" });
    });

    it("upload failures throw a plain Error with the response text, not MikeApiError", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(new Response("file too large", { status: 413 })),
        );

        const error = await uploadProjectDocument("p1", file).catch(
            (e: unknown) => e,
        );

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(MikeApiError);
        expect((error as Error).message).toBe("file too large");

        await expect(uploadStandaloneDocument(file)).rejects.toThrow(
            "file too large",
        );
        await expect(uploadLibraryDocument("files", file)).rejects.toThrow(
            "file too large",
        );
    });

    it("uploadDocumentVersion appends the filename field only when given", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(jsonResponse({ id: "v1" })),
        );

        await uploadDocumentVersion("d1", file, "renamed.pdf");
        let body = lastFetchCall().init.body as FormData;
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/single-documents/d1/versions",
        );
        expect(body.get("filename")).toBe("renamed.pdf");

        await uploadDocumentVersion("d1", file);
        body = lastFetchCall().init.body as FormData;
        expect(body.get("filename")).toBeNull();
    });

    it("replaceDocumentVersionFile PUTs to the version file route and surfaces errors", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ id: "v1" }));

        await replaceDocumentVersionFile("d1", "v1", file, "renamed.pdf");

        const { url, init } = lastFetchCall();
        expect(url).toBe(
            "http://localhost:3001/single-documents/d1/versions/v1/file",
        );
        expect(init.method).toBe("PUT");
        expect((init.body as FormData).get("filename")).toBe("renamed.pdf");

        fetchMock.mockResolvedValue(new Response("nope", { status: 409 }));
        await expect(
            replaceDocumentVersionFile("d1", "v1", file),
        ).rejects.toThrow("nope");
    });
});

describe("query and payload defaults", () => {
    it("getDocumentUrl appends version_id only when a version is requested", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                jsonResponse({ url: "u", filename: "f", version_id: null }),
            ),
        );

        await getDocumentUrl("d1");
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/single-documents/d1/url",
        );

        await getDocumentUrl("d1", "v 1");
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/single-documents/d1/url?version_id=v%201",
        );
    });

    it("createChat defaults to an empty JSON object body", async () => {
        fetchMock.mockResolvedValue(jsonResponse({ id: "c1" }));

        await createChat();
        expect(lastFetchCall().init.body).toBe("{}");
        fetchMock.mockResolvedValue(jsonResponse({ id: "c2" }));

        await createChat({ project_id: "p1" });
        expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
            project_id: "p1",
        });
    });

    it("listChats without options hits the bare /chat route", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listChats();

        expect(lastFetchCall().url).toBe("http://localhost:3001/chat");
    });

    it("folder creation defaults parent_folder_id to null, not undefined", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(jsonResponse({ id: "f1" })),
        );

        await createProjectFolder("p1", "Discovery");
        // null must survive JSON.stringify (undefined would drop the key and
        // the backend would reject the payload).
        expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
            name: "Discovery",
            parent_folder_id: null,
        });

        await createLibraryFolder("files", "Precedents", "parent-1");
        expect(JSON.parse(lastFetchCall().init.body as string)).toEqual({
            name: "Precedents",
            parent_folder_id: "parent-1",
        });
    });

    it("downloadDocumentsZip synthesizes a message when the error body is empty", async () => {
        fetchMock.mockResolvedValue(new Response("", { status: 500 }));

        await expect(downloadDocumentsZip(["d1"])).rejects.toThrow(
            "API error: 500",
        );
    });

    it("mapTRMessages degrades a null user body to an empty string", () => {
        const mapped = mapTRMessages([
            {
                id: "m1",
                chat_id: "c1",
                role: "user",
                content: null,
                created_at: "2026-01-01",
            },
        ]);
        expect(mapped).toEqual([{ role: "user", content: "" }]);
    });
});

// ---------------------------------------------------------------------------
// Workflows. The slash-command menu (PR #280) is fed by listWorkflows, and
// hide/unhide controls which ones it offers — a wrong route here silently
// empties the menu rather than erroring.
// ---------------------------------------------------------------------------

describe("workflow endpoints", () => {
    it("listWorkflows filters by type via the query string", async () => {
        fetchMock.mockResolvedValue(jsonResponse([]));

        await listWorkflows("assistant");

        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/workflows?type=assistant",
        );
    });

    it("hide/unhide/list use the hidden-workflows routes with matching methods", async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

        await hideWorkflow("w1");
        let { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/workflows/hidden");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ workflow_id: "w1" });

        await unhideWorkflow("w1");
        ({ url, init } = lastFetchCall());
        expect(url).toBe("http://localhost:3001/workflows/hidden/w1");
        expect(init.method).toBe("DELETE");

        fetchMock.mockResolvedValue(jsonResponse(["w2"]));
        await expect(listHiddenWorkflows()).resolves.toEqual(["w2"]);
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/workflows/hidden",
        );
    });
});

// ---------------------------------------------------------------------------
// Thin endpoint wrappers. Each is a one-liner over apiRequest, so the only
// things that can break are the route, the HTTP method, and the payload
// shape — a wrong route or a camelCase key that should be snake_case fails
// silently in TypeScript and only surfaces as a runtime 404/422. Assert
// exactly those three things for every wrapper.
// ---------------------------------------------------------------------------

describe("thin endpoint wrappers", () => {
    type WrapperCase = {
        name: string;
        call: () => Promise<unknown>;
        url: string;
        method?: string; // defaults to GET (fetch's default when unset)
        body?: unknown; // absent means the request must not carry a body
    };

    const cases: WrapperCase[] = [
        // Account & profile
        {
            name: "createProject",
            call: () => createProject("Acme v. Zenith", "CM-42", "litigation", ["a@b.c"]),
            url: "/projects",
            method: "POST",
            body: {
                name: "Acme v. Zenith",
                cm_number: "CM-42",
                practice: "litigation",
                shared_with: ["a@b.c"],
            },
        },
        {
            name: "deleteAccount",
            call: () => deleteAccount(),
            url: "/user/account",
            method: "DELETE",
        },
        {
            name: "deleteAllProjects",
            call: () => deleteAllProjects(),
            url: "/user/projects",
            method: "DELETE",
        },
        {
            name: "deleteAllTabularReviews",
            call: () => deleteAllTabularReviews(),
            url: "/user/tabular-reviews",
            method: "DELETE",
        },
        {
            name: "updateUserProfile",
            call: () => updateUserProfile({ displayName: "Amal", titleModel: "m1" }),
            url: "/user/profile",
            method: "PATCH",
            body: { displayName: "Amal", titleModel: "m1" },
        },
        {
            name: "updateUserMfaOnLogin",
            call: () => updateUserMfaOnLogin(true),
            url: "/user/security/mfa-login",
            method: "PATCH",
            body: { enabled: true },
        },
        {
            name: "getApiKeyStatus",
            call: () => getApiKeyStatus(),
            url: "/user/api-keys",
        },
        {
            name: "saveApiKey",
            call: () => saveApiKey("claude", "sk-ant-1"),
            url: "/user/api-keys/claude",
            method: "PUT",
            body: { api_key: "sk-ant-1" },
        },
        {
            // null is the delete-my-key signal and must survive
            // JSON.stringify rather than dropping the field.
            name: "saveApiKey (clear)",
            call: () => saveApiKey("openai", null),
            url: "/user/api-keys/openai",
            method: "PUT",
            body: { api_key: null },
        },
        // MCP connectors
        {
            name: "listMcpConnectors",
            call: () => listMcpConnectors(),
            url: "/user/mcp-connectors",
        },
        {
            name: "getMcpConnector",
            call: () => getMcpConnector("m1"),
            url: "/user/mcp-connectors/m1",
        },
        {
            name: "createMcpConnector",
            call: () =>
                createMcpConnector({
                    name: "Drive",
                    serverUrl: "https://mcp.example/mcp/v1",
                    bearerToken: "tok",
                }),
            url: "/user/mcp-connectors",
            method: "POST",
            body: {
                name: "Drive",
                serverUrl: "https://mcp.example/mcp/v1",
                bearerToken: "tok",
            },
        },
        {
            name: "updateMcpConnector",
            call: () => updateMcpConnector("m1", { enabled: false }),
            url: "/user/mcp-connectors/m1",
            method: "PATCH",
            body: { enabled: false },
        },
        {
            name: "deleteMcpConnector",
            call: () => deleteMcpConnector("m1"),
            url: "/user/mcp-connectors/m1",
            method: "DELETE",
        },
        {
            name: "refreshMcpConnectorTools",
            call: () => refreshMcpConnectorTools("m1"),
            url: "/user/mcp-connectors/m1/refresh-tools",
            method: "POST",
        },
        {
            name: "startMcpConnectorOAuth",
            call: () => startMcpConnectorOAuth("m1"),
            url: "/user/mcp-connectors/m1/oauth/start",
            method: "POST",
        },
        {
            name: "setMcpToolEnabled",
            call: () => setMcpToolEnabled("m1", "t1", true),
            url: "/user/mcp-connectors/m1/tools/t1",
            method: "PATCH",
            body: { enabled: true },
        },
        // Projects
        {
            name: "getProject",
            call: () => getProject("p1"),
            url: "/projects/p1",
        },
        {
            name: "updateProject",
            call: () => updateProject("p1", { name: "Renamed", practice: null }),
            url: "/projects/p1",
            method: "PATCH",
            body: { name: "Renamed", practice: null },
        },
        {
            name: "deleteProject",
            call: () => deleteProject("p1"),
            url: "/projects/p1",
            method: "DELETE",
        },
        {
            name: "getProjectPeople",
            call: () => getProjectPeople("p1"),
            url: "/projects/p1/people",
        },
        {
            name: "listProjectChats",
            call: () => listProjectChats("p1"),
            url: "/projects/p1/chats",
        },
        // Project folders & documents
        {
            name: "renameProjectFolder",
            call: () => renameProjectFolder("p1", "f1", "Discovery"),
            url: "/projects/p1/folders/f1",
            method: "PATCH",
            body: { name: "Discovery" },
        },
        {
            name: "deleteProjectFolder",
            call: () => deleteProjectFolder("p1", "f1"),
            url: "/projects/p1/folders/f1",
            method: "DELETE",
        },
        {
            // Moving to the root sends an explicit null parent, on the same
            // PATCH route as rename — only the body distinguishes them.
            name: "moveSubfolderToFolder",
            call: () => moveSubfolderToFolder("p1", "f1", null),
            url: "/projects/p1/folders/f1",
            method: "PATCH",
            body: { parent_folder_id: null },
        },
        {
            name: "moveDocumentToFolder",
            call: () => moveDocumentToFolder("p1", "d1", "f2"),
            url: "/projects/p1/documents/d1/folder",
            method: "PATCH",
            body: { folder_id: "f2" },
        },
        {
            name: "renameProjectDocument",
            call: () => renameProjectDocument("p1", "d1", "renamed.pdf"),
            url: "/projects/p1/documents/d1",
            method: "PATCH",
            body: { filename: "renamed.pdf" },
        },
        {
            name: "addDocumentToProject",
            call: () => addDocumentToProject("p1", "d1"),
            url: "/projects/p1/documents/d1",
            method: "POST",
        },
        // Library
        {
            name: "getLibrary",
            call: () => getLibrary("templates"),
            url: "/library/templates",
        },
        {
            name: "renameLibraryFolder",
            call: () => renameLibraryFolder("files", "f1", "Precedents"),
            url: "/library/files/folders/f1",
            method: "PATCH",
            body: { name: "Precedents" },
        },
        {
            name: "deleteLibraryFolder",
            call: () => deleteLibraryFolder("files", "f1"),
            url: "/library/files/folders/f1",
            method: "DELETE",
        },
        {
            name: "moveLibraryFolder",
            call: () => moveLibraryFolder("templates", "f1", "parent-1"),
            url: "/library/templates/folders/f1",
            method: "PATCH",
            body: { parent_folder_id: "parent-1" },
        },
        {
            name: "moveLibraryDocument",
            call: () => moveLibraryDocument("files", "d1", null),
            url: "/library/files/documents/d1/folder",
            method: "PATCH",
            body: { folder_id: null },
        },
        {
            name: "renameLibraryDocument",
            call: () => renameLibraryDocument("files", "d1", "renamed.docx"),
            url: "/library/files/documents/d1",
            method: "PATCH",
            body: { filename: "renamed.docx" },
        },
        // Standalone documents & versions
        {
            name: "listStandaloneDocuments",
            call: () => listStandaloneDocuments(),
            url: "/single-documents",
        },
        {
            name: "deleteDocument",
            call: () => deleteDocument("d1"),
            url: "/single-documents/d1",
            method: "DELETE",
        },
        {
            name: "listDocumentVersions",
            call: () => listDocumentVersions("d1"),
            url: "/single-documents/d1/versions",
        },
        {
            name: "copyDocumentVersionFromDocument",
            call: () => copyDocumentVersionFromDocument("d1", "src-1", "copy.pdf"),
            url: "/single-documents/d1/versions/from-document",
            method: "POST",
            body: { source_document_id: "src-1", filename: "copy.pdf" },
        },
        {
            // null clears the per-version name so the document name shows.
            name: "renameDocumentVersion",
            call: () => renameDocumentVersion("d1", "v1", null),
            url: "/single-documents/d1/versions/v1",
            method: "PATCH",
            body: { filename: null },
        },
        {
            name: "deleteDocumentVersion",
            call: () => deleteDocumentVersion("d1", "v1"),
            url: "/single-documents/d1/versions/v1",
            method: "DELETE",
        },
        // Chat
        {
            name: "renameChat",
            call: () => renameChat("c1", "New title"),
            url: "/chat/c1",
            method: "PATCH",
            body: { title: "New title" },
        },
        {
            name: "deleteChat",
            call: () => deleteChat("c1"),
            url: "/chat/c1",
            method: "DELETE",
        },
        {
            name: "generateChatTitle",
            call: () => generateChatTitle("c1", "first message"),
            url: "/chat/c1/generate-title",
            method: "POST",
            body: { message: "first message" },
        },
        // Tabular review
        {
            name: "getTabularReview",
            call: () => getTabularReview("r1"),
            url: "/tabular-review/r1",
        },
        {
            name: "getTabularReviewPeople",
            call: () => getTabularReviewPeople("r1"),
            url: "/tabular-review/r1/people",
        },
        // Workflows
        {
            name: "getWorkflow",
            call: () => getWorkflow("w1"),
            url: "/workflows/w1",
        },
        {
            name: "createWorkflow",
            call: () =>
                createWorkflow({
                    metadata: { title: "NDA review", type: "assistant" },
                    skill_md: "# Steps",
                }),
            url: "/workflows",
            method: "POST",
            body: {
                metadata: { title: "NDA review", type: "assistant" },
                skill_md: "# Steps",
            },
        },
        {
            name: "updateWorkflow",
            call: () => updateWorkflow("w1", { metadata: { title: "Renamed" } }),
            url: "/workflows/w1",
            method: "PATCH",
            body: { metadata: { title: "Renamed" } },
        },
        {
            name: "deleteWorkflow",
            call: () => deleteWorkflow("w1"),
            url: "/workflows/w1",
            method: "DELETE",
        },
        {
            name: "openSourceWorkflow",
            call: () =>
                openSourceWorkflow("w1", {
                    contributor_mode: "named",
                    contributor: {
                        name: "Amal",
                        organisation: null,
                        role: null,
                        linkedin: null,
                    },
                }),
            url: "/workflows/w1/open-source",
            method: "POST",
            body: {
                contributor_mode: "named",
                contributor: {
                    name: "Amal",
                    organisation: null,
                    role: null,
                    linkedin: null,
                },
            },
        },
        {
            name: "shareWorkflow",
            call: () =>
                shareWorkflow("w1", { emails: ["a@b.c"], allow_edit: false }),
            url: "/workflows/w1/share",
            method: "POST",
            body: { emails: ["a@b.c"], allow_edit: false },
        },
        {
            name: "listWorkflowShares",
            call: () => listWorkflowShares("w1"),
            url: "/workflows/w1/shares",
        },
        {
            name: "deleteWorkflowShare",
            call: () => deleteWorkflowShare("w1", "s1"),
            url: "/workflows/w1/shares/s1",
            method: "DELETE",
        },
    ];

    it.each(cases)("$name → $method $url", async ({ call, url, method, body }) => {
        fetchMock.mockResolvedValue(jsonResponse({}));

        await call();

        const { url: actualUrl, init } = lastFetchCall();
        expect(actualUrl).toBe(`http://localhost:3001${url}`);
        expect(init.method ?? "GET").toBe(method ?? "GET");
        if (body !== undefined) {
            expect(JSON.parse(init.body as string)).toEqual(body);
            expect(init.headers).toMatchObject({
                "Content-Type": "application/json",
            });
        } else {
            expect(init.body).toBeUndefined();
        }
        expect(init.headers).toMatchObject({
            Authorization: "Bearer token-123",
        });
    });
});

// ---------------------------------------------------------------------------
// Wrappers with response mapping — the ones the table above can't cover
// because they unwrap an envelope or hit the blob path.
// ---------------------------------------------------------------------------

describe("unwrapping and blob wrappers", () => {
    it("getOllamaModels unwraps the models envelope", async () => {
        const models = [
            { id: "ollama/llama3.2", label: "Llama 3.2", group: "Local" },
        ];
        fetchMock.mockResolvedValue(jsonResponse({ models }));

        await expect(getOllamaModels()).resolves.toEqual(models);
        expect(lastFetchCall().url).toBe("http://localhost:3001/models/ollama");
    });

    it("getCourtlistenerOpinions posts the cluster id and unwraps opinions", async () => {
        const opinions = [
            {
                opinionId: 7,
                type: "majority",
                author: "Judge X",
                url: "https://example.test/op/7",
            },
        ];
        fetchMock.mockResolvedValue(jsonResponse({ opinions }));

        await expect(getCourtlistenerOpinions(123)).resolves.toEqual(opinions);
        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/case-law/case-opinions");
        expect(init.method).toBe("POST");
        expect(JSON.parse(init.body as string)).toEqual({ clusterId: 123 });
    });

    it("exportChatData and exportTabularReviewsData hit their export routes", async () => {
        fetchMock.mockImplementation(() =>
            Promise.resolve(
                new Response("bytes", {
                    status: 200,
                    headers: {
                        "content-disposition": 'attachment; filename="x.zip"',
                    },
                }),
            ),
        );

        const chats = await exportChatData();
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/user/chats/export",
        );
        expect(chats.filename).toBe("x.zip");
        expect(await chats.blob.text()).toBe("bytes");

        await exportTabularReviewsData();
        expect(lastFetchCall().url).toBe(
            "http://localhost:3001/user/tabular-reviews/export",
        );
    });
});
