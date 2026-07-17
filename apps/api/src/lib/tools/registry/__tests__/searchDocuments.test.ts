import { describe, it, expect, beforeEach, vi } from "vitest";

// Offline module loading: mock env (avoid Zod validation) + supabase (no client).
vi.mock("../../../env", () => ({
    env: { NODE_ENV: "test", OPENAI_ALLOW_LOCAL_BASE_URL: "false" },
}));
vi.mock("../../../supabase", () => ({ createServerSupabase: vi.fn() }));

import { documentToolHandlers } from "../documentTools";
import type { ToolExecutionContext } from "../context";
import {
    registerEmbeddingProvider,
    _resetEmbeddingRegistryForTesting,
    type EmbeddingProviderAdapter,
} from "../../../llm/embeddings";

const NONCE = "NONCE-123";

function fakeProvider(): EmbeddingProviderAdapter {
    return {
        id: "fake-embed",
        // Match whatever resolveEmbeddingModel() returns (the cloud default here).
        matchesModel: () => true,
        dimensions: 2,
        models: ["fake"],
        embed: async (texts) => texts.map(() => [0.1, 0.2]),
    };
}

type RpcArgs = Record<string, unknown>;

function makeCtx(opts: {
    matches: unknown[];
    onRpc?: (args: RpcArgs) => void;
}): ToolExecutionContext {
    const db = {
        rpc: async (_name: string, args: RpcArgs) => {
            opts.onRpc?.(args);
            return { data: opts.matches, error: null };
        },
    };
    return {
        toolCallId: "call-1",
        docStore: new Map([
            ["doc-0", { storage_path: "", file_type: "pdf", filename: "Contract.pdf" }],
        ]),
        docIndex: { "doc-0": { document_id: "DID-0", filename: "Contract.pdf" } },
        userId: "u1",
        db: db as never,
        write: () => {},
        apiKeys: {},
        nonce: NONCE,
        results: {
            toolResults: [],
            docsRead: [],
            docsFound: [],
            docsCreated: [],
            docsReplicated: [],
            workflowsApplied: [],
            docsEdited: [],
            courtlistenerEvents: [],
            caseCitationEvents: [],
            mcpEvents: [],
        },
        courtState: {} as never,
        findInCaseGroup: {} as never,
    } as ToolExecutionContext;
}

const handler = documentToolHandlers.search_documents;

beforeEach(() => {
    _resetEmbeddingRegistryForTesting();
    registerEmbeddingProvider(fakeProvider());
});

describe("search_documents tool handler", () => {
    it("is registered in the document tool registry", () => {
        expect(typeof handler).toBe("function");
    });

    it("embeds the query, spotlight-fences each chunk, and emits a citation reminder", async () => {
        let rpcArgs: RpcArgs | undefined;
        const ctx = makeCtx({
            matches: [
                {
                    document_id: "DID-0",
                    version_id: "v1",
                    chunk_index: 2,
                    content: "The indemnity clause is unlimited.",
                    page: 4,
                    distance: 0.12,
                },
            ],
            onRpc: (args) => (rpcArgs = args),
        });

        await handler({ query: "indemnity" }, ctx);

        // Query was embedded via the fake provider and serialized as a literal.
        expect(rpcArgs?.p_query_embedding).toBe("[0.1,0.2]");
        // Scoped to the chat's document ids (authz boundary).
        expect(rpcArgs?.p_document_ids).toEqual(["DID-0"]);

        const content = ctx.results.toolResults[0] as { content: string };
        // Untrusted chunk body is spotlight-fenced with the turn nonce.
        expect(content.content).toContain(`<untrusted-content nonce="${NONCE}">`);
        expect(content.content).toContain("The indemnity clause is unlimited.");
        // Citation reminder maps document_id -> the doc-N label + filename + page.
        expect(content.content).toContain('"doc-0"');
        expect(content.content).toContain("Contract.pdf");
        expect(content.content).toContain("page 4");

        // Records one docsFound entry for the matched document.
        expect(ctx.results.docsFound).toEqual([
            { filename: "Contract.pdf", query: "indemnity", total_matches: 1 },
        ]);
    });

    it("returns an error result for an empty query", async () => {
        const ctx = makeCtx({ matches: [] });
        await handler({ query: "   " }, ctx);
        const content = ctx.results.toolResults[0] as { content: string };
        expect(content.content).toContain("query is required");
    });

    it("degrades gracefully when no embedding provider is available (air-gap w/o local)", async () => {
        _resetEmbeddingRegistryForTesting(); // leave the registry empty
        const ctx = makeCtx({ matches: [] });
        await handler({ query: "anything" }, ctx);
        const content = ctx.results.toolResults[0] as { content: string };
        expect(content.content).toContain("unavailable");
        // No matches recorded — the turn is not errored.
        expect(ctx.results.docsFound).toEqual([]);
    });
});
