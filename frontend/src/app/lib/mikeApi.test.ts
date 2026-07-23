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
    deleteAllChats,
    downloadDocumentsZip,
    exportAccountData,
    getChat,
    getUserProfile,
    isMfaRequiredError,
    listChats,
    listProjects,
    lookupUserByEmail,
    mapTRMessages,
    streamChat,
    streamProjectChat,
    streamTabularChat,
    streamTabularGeneration,
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
            signal: controller.signal,
        });

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/projects/p1/chat");
        expect(init.signal).toBe(controller.signal);
        expect(JSON.parse(init.body as string)).toEqual({
            messages: [{ role: "user", content: "hi" }],
            displayed_doc: { filename: "a.pdf", document_id: "d1" },
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
            { reviewTitle: "Leases", projectName: null },
        );

        const { url, init } = lastFetchCall();
        expect(url).toBe("http://localhost:3001/tabular-review/r1/chat");
        expect(JSON.parse(init.body as string)).toEqual({
            messages: [{ role: "user", content: "summarize" }],
            review_title: "Leases",
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
