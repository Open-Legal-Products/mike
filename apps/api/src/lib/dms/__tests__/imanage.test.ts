import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock DNS so the SSRF guard in guardedFetch resolves the tenant host to a
// public IP without touching the network (same approach as the MCP ssrf test).
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));

import { IManageAdapter } from "../imanage";

const BASE = "https://tenant.imanage.com";
const TOKEN = "imanage-access-token";

function publicDns() {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
}

interface Captured {
    url: string;
    init: RequestInit | undefined;
}

let calls: Captured[];

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
    return vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((input: unknown, init?: RequestInit) => {
            const url =
                typeof input === "string"
                    ? input
                    : input instanceof URL
                      ? input.toString()
                      : (input as Request).url;
            calls.push({ url, init });
            return Promise.resolve(handler(url, init));
        });
}

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
    });
}

function adapter() {
    return new IManageAdapter({
        baseUrl: BASE,
        customerId: "42",
        library: "ACTIVE",
        getAccessToken: async () => TOKEN,
    });
}

const ROOT = `${BASE}/api/v2/customers/42/libraries/ACTIVE`;

beforeEach(() => {
    calls = [];
    lookupMock.mockReset();
    publicDns();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("IManageAdapter", () => {
    it("is enabled only with base url + customer + library", () => {
        expect(adapter().enabled).toBe(true);
        expect(
            new IManageAdapter({ baseUrl: BASE, getAccessToken: async () => TOKEN })
                .enabled,
        ).toBe(false);
    });

    it("authenticates with a Bearer token against the workspaces probe", async () => {
        mockFetch(() => json({ data: [] }));
        const res = await adapter().authenticate();
        expect(res.ok).toBe(true);
        expect(calls[0].url).toBe(`${ROOT}/workspaces?limit=1`);
        const headers = new Headers(calls[0].init?.headers as HeadersInit);
        expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("reports auth failure instead of throwing", async () => {
        mockFetch(() => json({ error: "nope" }, 401));
        const res = await adapter().authenticate();
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/401/);
    });

    it("lists workspaces at the top level and folder children below", async () => {
        mockFetch((url) => {
            if (url.endsWith("/workspaces"))
                return json({ data: [{ id: "ws1", name: "Client A" }] });
            return json({ data: [{ id: "f2", name: "Pleadings" }] });
        });
        const dms = adapter();
        const top = await dms.listFolders();
        expect(top).toEqual([{ id: "ws1", name: "Client A", parentId: null }]);
        const children = await dms.listFolders("ws1");
        expect(children).toEqual([
            { id: "f2", name: "Pleadings", parentId: "ws1" },
        ]);
        expect(calls[1].url).toBe(`${ROOT}/folders/ws1/children`);
    });

    it("searches documents and surfaces the version", async () => {
        mockFetch(() =>
            json({
                data: [
                    { id: "d1", name: "Brief.pdf", mime: "application/pdf", version: 3 },
                ],
            }),
        );
        const results = await adapter().search("brief", { limit: 10 });
        expect(results).toEqual([
            {
                id: "d1",
                name: "Brief.pdf",
                folderId: null,
                contentType: "application/pdf",
                version: "3",
            },
        ]);
        expect(calls[0].url).toContain(`${ROOT}/documents/search?`);
        expect(calls[0].url).toContain("q=brief");
    });

    it("fetches a document with metadata + bytes + version", async () => {
        const bytes = new TextEncoder().encode("%PDF-1.7 body");
        mockFetch((url) => {
            if (url.endsWith("/download"))
                return new Response(bytes, {
                    status: 200,
                    headers: { "content-length": String(bytes.byteLength) },
                });
            return json({
                data: {
                    id: "d1",
                    name: "Brief",
                    extension: "pdf",
                    mime: "application/pdf",
                    version: 3,
                    size: bytes.byteLength,
                },
            });
        });
        const doc = await adapter().fetchDocument("d1");
        expect(doc).not.toBeNull();
        expect(doc!.version).toBe("3");
        expect(doc!.metadata.extension).toBe("pdf");
        expect(doc!.metadata.sizeBytes).toBe(bytes.byteLength);
        expect(new Uint8Array(doc!.content)).toEqual(bytes);
        expect(calls.some((c) => c.url === `${ROOT}/documents/d1/download`)).toBe(
            true,
        );
    });

    it("exports a new version and returns the new version id", async () => {
        mockFetch(() => json({ data: { version: 4 } }));
        const content = new TextEncoder().encode("new content").buffer;
        const res = await adapter().exportDocument("d1", content as ArrayBuffer, {
            newVersion: true,
        });
        expect(res).toEqual({ docId: "d1", version: "4" });
        expect(calls[0].url).toBe(`${ROOT}/documents/d1/versions`);
        expect(calls[0].init?.method).toBe("POST");
    });

    it("routes every request through the SSRF guard (redirect:manual)", async () => {
        mockFetch(() => json({ data: [] }));
        await adapter().authenticate();
        // guardedFetch always injects redirect:"manual" + a pinned dispatcher.
        expect((calls[0].init as RequestInit).redirect).toBe("manual");
        expect(lookupMock).toHaveBeenCalled();
    });

    it("rejects a tenant host that resolves to a private IP", async () => {
        lookupMock.mockResolvedValue([{ address: "10.0.0.5", family: 4 }]);
        mockFetch(() => json({ data: [] }));
        const res = await adapter().authenticate();
        expect(res.ok).toBe(false);
        expect(res.error).toMatch(/blocked network address/);
    });
});
