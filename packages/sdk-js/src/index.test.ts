import { describe, expect, it } from "vitest";
import { MikeApiError } from "@mike/api-client";
import { MikeClient } from "./index";

// MikeClient is the external-consumer entry point: it turns an `apiKey`
// string into auth headers and delegates every call to @mike/api-client.
// These tests pin that seam — the header contract and the URL/method each
// facade method produces — because an external SDK breaks silently: no app
// in this repo exercises it, so only tests notice a regression.

type RecordedCall = { url: string; init: RequestInit | undefined };

// A fetch stand-in that records every call and answers with a fixed JSON body.
function recordingFetch(
    body: unknown = [],
    init: { status?: number } = {},
): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
    const calls: RecordedCall[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, i?: RequestInit) => {
        calls.push({ url: String(input), init: i });
        return new Response(JSON.stringify(body), {
            status: init.status ?? 200,
            headers: { "content-type": "application/json" },
        });
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
}

function headersOf(call: RecordedCall): Record<string, string> {
    return (call.init?.headers ?? {}) as Record<string, string>;
}

describe("MikeClient auth", () => {
    it("sends the apiKey as a Bearer Authorization header", async () => {
        const { calls, fetchImpl } = recordingFetch();
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            apiKey: "mike-key-123",
            fetchImpl,
        });

        await client.projects.list();

        expect(calls).toHaveLength(1);
        expect(headersOf(calls[0]).Authorization).toBe("Bearer mike-key-123");
    });

    it("sends no Authorization header when no apiKey is given", async () => {
        const { calls, fetchImpl } = recordingFetch();
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            fetchImpl,
        });

        await client.projects.list();

        expect(headersOf(calls[0]).Authorization).toBeUndefined();
    });

    it("prefers an explicit getAuthHeaders over apiKey", async () => {
        const { calls, fetchImpl } = recordingFetch();
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            apiKey: "should-not-be-used",
            getAuthHeaders: async () => ({ Authorization: "Bearer custom" }),
            fetchImpl,
        });

        await client.projects.list();

        expect(headersOf(calls[0]).Authorization).toBe("Bearer custom");
    });
});

describe("MikeClient delegation", () => {
    it("projects.list GETs /projects on the configured base URL", async () => {
        const { calls, fetchImpl } = recordingFetch([]);
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            fetchImpl,
        });

        await client.projects.list();

        expect(calls[0].url).toBe("https://api.example.com/projects");
        expect(calls[0].init?.method).toBeUndefined(); // GET default
    });

    it("projects.create POSTs the JSON body api-client builds", async () => {
        const { calls, fetchImpl } = recordingFetch({ id: "p1" });
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            fetchImpl,
        });

        await client.projects.create("Acme Merger", "CM-42");

        expect(calls[0].url).toBe("https://api.example.com/projects");
        expect(calls[0].init?.method).toBe("POST");
        expect(JSON.parse(String(calls[0].init?.body))).toEqual({
            name: "Acme Merger",
            cm_number: "CM-42",
        });
    });

    it("chats.list forwards the limit as a query parameter", async () => {
        const { calls, fetchImpl } = recordingFetch([]);
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            fetchImpl,
        });

        await client.chats.list({ limit: 5 });

        expect(calls[0].url).toBe("https://api.example.com/chat?limit=5");
    });

    it("surfaces API failures as MikeApiError with the response status", async () => {
        const { fetchImpl } = recordingFetch(
            { error: "nope" },
            { status: 403 },
        );
        const client = new MikeClient({
            baseUrl: "https://api.example.com",
            fetchImpl,
        });

        const failure = client.projects.get("p1");

        await expect(failure).rejects.toBeInstanceOf(MikeApiError);
        await expect(failure).rejects.toMatchObject({ status: 403 });
    });
});
