import { afterEach, describe, expect, it } from "vitest";
import {
    configureMikeApiClient,
    createMikeApiClient,
    getCourtlistenerOpinions,
    isMfaRequiredError,
    mapTRMessages,
    MikeApiError,
} from "./index";

// This client hand-remaps the server's snake_case JSON into the camelCase (and
// event-flattened) shapes the apps render. That remap is exactly where contract
// drift bites — a renamed or newly-nullable server field silently produces
// `undefined` at the call site. These tests pin the mapping field-by-field from
// realistic server fixtures so the drift surfaces here instead of in the UI.

// A fetch stand-in that returns a fixed JSON body, so a mapper can be exercised
// without a network. `content-type` is set so the client parses it as JSON.
function jsonFetch(
    body: unknown,
    init: { status?: number } = {},
): typeof fetch {
    return (async () =>
        new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers: { "content-type": "application/json" },
        })) as unknown as typeof fetch;
}

describe("getChat message mapping", () => {
    it("maps a user message's content, files, and workflow", async () => {
        const client = createMikeApiClient({
            fetchImpl: jsonFetch({
                chat: {
                    id: "chat-1",
                    project_id: null,
                    user_id: "user-1",
                    title: "Draft NDA",
                    created_at: "2026-01-01T00:00:00Z",
                },
                messages: [
                    {
                        id: "m1",
                        chat_id: "chat-1",
                        role: "user",
                        content: "summarise this",
                        files: [
                            { filename: "nda.pdf", document_id: "doc-1" },
                        ],
                        workflow: { id: "wf-1", title: "Summarise" },
                        created_at: "2026-01-01T00:00:01Z",
                    },
                ],
            }),
        });

        const { chat, messages } = await client.chats.get("chat-1");

        // The chat object is passed through untouched.
        expect(chat.id).toBe("chat-1");
        expect(messages).toHaveLength(1);
        expect(messages[0]).toEqual({
            id: "m1",
            role: "user",
            content: "summarise this",
            files: [{ filename: "nda.pdf", document_id: "doc-1" }],
            workflow: { id: "wf-1", title: "Summarise" },
        });
    });

    it("flattens an assistant message's content events into text and keeps citations", async () => {
        const client = createMikeApiClient({
            fetchImpl: jsonFetch({
                chat: {
                    id: "chat-2",
                    project_id: "proj-1",
                    user_id: "user-1",
                    title: null,
                    created_at: "2026-01-01T00:00:00Z",
                },
                messages: [
                    {
                        id: "m2",
                        chat_id: "chat-2",
                        role: "assistant",
                        // Only `content` events contribute to the rendered text;
                        // interleaved reasoning must be ignored by the join.
                        content: [
                            { type: "content", text: "Hello " },
                            { type: "reasoning", text: "(thinking)" },
                            { type: "content", text: "world" },
                        ],
                        citations: [
                            {
                                type: "citation_data",
                                kind: "document",
                                ref: 1,
                                quote: "clause 4",
                            },
                        ],
                        created_at: "2026-01-01T00:00:02Z",
                    },
                ],
            }),
        });

        const { messages } = await client.chats.get("chat-2");
        const msg = messages[0];
        expect(msg.role).toBe("assistant");
        expect(msg.content).toBe("Hello world");
        expect(msg.citations).toHaveLength(1);
        // The raw event array is preserved on `events` for re-rendering.
        expect(msg.events).toHaveLength(3);
    });

    it("defaults missing/nullable fields instead of leaking null", async () => {
        const client = createMikeApiClient({
            fetchImpl: jsonFetch({
                chat: {
                    id: "chat-3",
                    project_id: null,
                    user_id: "user-1",
                    title: null,
                    created_at: "2026-01-01T00:00:00Z",
                },
                messages: [
                    {
                        id: "m3",
                        chat_id: "chat-3",
                        role: "user",
                        // Non-string user content collapses to "".
                        content: null,
                        files: null,
                        workflow: null,
                        created_at: "2026-01-01T00:00:03Z",
                    },
                    {
                        id: "m4",
                        chat_id: "chat-3",
                        role: "assistant",
                        // Non-array assistant content -> "" and no events.
                        content: null,
                        citations: null,
                        created_at: "2026-01-01T00:00:04Z",
                    },
                ],
            }),
        });

        const { messages } = await client.chats.get("chat-3");
        expect(messages[0]).toEqual({
            id: "m3",
            role: "user",
            content: "",
            files: undefined,
            workflow: undefined,
        });
        expect(messages[1]).toEqual({
            id: "m4",
            role: "assistant",
            content: "",
            citations: undefined,
            events: undefined,
        });
    });
});

describe("mapTRMessages", () => {
    it("maps user rows to plain content and assistant rows to flattened text + events", () => {
        const mapped = mapTRMessages([
            {
                id: "t1",
                chat_id: "c1",
                role: "user",
                content: "which docs mention indemnity?",
                created_at: "2026-01-01T00:00:00Z",
            },
            {
                id: "t2",
                chat_id: "c1",
                role: "assistant",
                content: [
                    { type: "content", text: "Rows " },
                    { type: "content", text: "3 and 7." },
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ] as any,
                annotations: [
                    {
                        type: "tabular_citation",
                        ref: 1,
                        col_index: 2,
                        row_index: 3,
                        col_name: "Indemnity",
                        doc_name: "msa.pdf",
                        quote: "shall indemnify",
                    },
                ],
                created_at: "2026-01-01T00:00:01Z",
            },
        ]);

        expect(mapped[0]).toEqual({
            role: "user",
            content: "which docs mention indemnity?",
        });
        expect(mapped[1].role).toBe("assistant");
        expect(mapped[1].content).toBe("Rows 3 and 7.");
        expect(mapped[1].events).toHaveLength(2);
        expect(mapped[1].annotations).toHaveLength(1);
    });

    it("collapses non-array assistant content to an empty string with no events", () => {
        const [msg] = mapTRMessages([
            {
                id: "t3",
                chat_id: "c1",
                role: "assistant",
                content: null,
                created_at: "2026-01-01T00:00:02Z",
            },
        ]);
        expect(msg.content).toBe("");
        expect(msg.events).toBeUndefined();
        expect(msg.annotations).toBeUndefined();
    });
});

describe("error-shape mapping", () => {
    it("reads the { error: { code, message } } shape into MikeApiError", async () => {
        const client = createMikeApiClient({
            fetchImpl: jsonFetch(
                { error: { code: "rate_limited", message: "Slow down" } },
                { status: 429 },
            ),
        });
        await expect(client.projects.list()).rejects.toMatchObject({
            name: "MikeApiError",
            status: 429,
            code: "rate_limited",
            message: "Slow down",
        });
    });

    it("falls back to the { detail, code } shape", async () => {
        const client = createMikeApiClient({
            fetchImpl: jsonFetch(
                { detail: "Not allowed", code: "forbidden" },
                { status: 403 },
            ),
        });
        await expect(client.projects.list()).rejects.toMatchObject({
            status: 403,
            code: "forbidden",
            message: "Not allowed",
        });
    });

    it("detects the MFA-required error shape", async () => {
        const client = createMikeApiClient({
            fetchImpl: jsonFetch(
                { code: "mfa_verification_required", detail: "MFA needed" },
                { status: 403 },
            ),
        });
        const error = await client.projects.list().catch((e) => e);
        expect(error).toBeInstanceOf(MikeApiError);
        expect(isMfaRequiredError(error)).toBe(true);
    });

    it("carries a non-JSON error body as the message with a null code", async () => {
        const client = createMikeApiClient({
            fetchImpl: (async () =>
                new Response("upstream boom", {
                    status: 502,
                })) as unknown as typeof fetch,
        });
        await expect(client.projects.list()).rejects.toMatchObject({
            status: 502,
            code: null,
            message: "upstream boom",
        });
    });
});

describe("getCourtlistenerOpinions", () => {
    // getCourtlistenerOpinions uses the module-global client, so configure it
    // and reset afterwards.
    afterEach(() => {
        configureMikeApiClient({
            fetchImpl: (...args: Parameters<typeof fetch>) => fetch(...args),
        });
    });

    it("unwraps the { opinions } envelope", async () => {
        configureMikeApiClient({
            getAuthHeaders: async () => ({}),
            fetchImpl: jsonFetch({
                opinions: [
                    {
                        opinionId: 5,
                        type: "010combined",
                        author: "J. Doe",
                        url: "https://example.test/op/5",
                    },
                ],
            }),
        });
        const opinions = await getCourtlistenerOpinions(123);
        expect(opinions).toHaveLength(1);
        expect(opinions[0].opinionId).toBe(5);
    });
});
