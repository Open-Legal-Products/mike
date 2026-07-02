import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({ default: { lookup: lookupMock } }));

import { NetDocumentsAdapter } from "../netdocuments";

const BASE = "https://api.netdocuments.com";
const TOKEN = "netdocs-access-token";
const V2 = `${BASE}/v2`;

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
    return new NetDocumentsAdapter({
        baseUrl: BASE,
        repository: "CAB-1",
        getAccessToken: async () => TOKEN,
    });
}

beforeEach(() => {
    calls = [];
    lookupMock.mockReset();
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("NetDocumentsAdapter", () => {
    it("is enabled only with base url + cabinet", () => {
        expect(adapter().enabled).toBe(true);
        expect(
            new NetDocumentsAdapter({
                baseUrl: BASE,
                getAccessToken: async () => TOKEN,
            }).enabled,
        ).toBe(false);
    });

    it("authenticates against the cabinet info endpoint with a Bearer token", async () => {
        mockFetch(() => json({ id: "CAB-1" }));
        const res = await adapter().authenticate();
        expect(res.ok).toBe(true);
        expect(calls[0].url).toBe(`${V2}/cabinet/CAB-1/info`);
        const headers = new Headers(calls[0].init?.headers as HeadersInit);
        expect(headers.get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("lists cabinet folders at top level and folder content below", async () => {
        mockFetch((url) => {
            if (url.endsWith("/folders"))
                return json({ results: [{ id: "fld1", name: "Deals" }] });
            return json({ results: [{ id: "fld2", name: "NDAs" }] });
        });
        const dms = adapter();
        const top = await dms.listFolders();
        expect(top).toEqual([{ id: "fld1", name: "Deals", parentId: null }]);
        const children = await dms.listFolders("fld1");
        expect(children).toEqual([{ id: "fld2", name: "NDAs", parentId: "fld1" }]);
        expect(calls[1].url).toBe(`${V2}/folder/fld1/content?type=folder`);
    });

    it("searches the cabinet and surfaces the version", async () => {
        mockFetch(() =>
            json({ results: [{ id: "e1", name: "NDA.pdf", ext: "pdf", version: 2 }] }),
        );
        const results = await adapter().search("nda", { limit: 5 });
        expect(results).toEqual([
            {
                id: "e1",
                name: "NDA.pdf",
                folderId: null,
                contentType: "application/pdf",
                version: "2",
            },
        ]);
        expect(calls[0].url).toContain(`${V2}/search/CAB-1?`);
        expect(calls[0].url).toContain("q=nda");
    });

    it("fetches a document with metadata + bytes + version", async () => {
        const bytes = new TextEncoder().encode("%PDF nd body");
        mockFetch((url) => {
            if (url.endsWith("/content"))
                return new Response(bytes, {
                    status: 200,
                    headers: { "content-length": String(bytes.byteLength) },
                });
            return json({
                id: "e1",
                name: "NDA.pdf",
                ext: "pdf",
                version: 2,
                size: bytes.byteLength,
            });
        });
        const doc = await adapter().fetchDocument("e1");
        expect(doc).not.toBeNull();
        expect(doc!.version).toBe("2");
        expect(doc!.metadata.extension).toBe("pdf");
        expect(new Uint8Array(doc!.content)).toEqual(bytes);
        expect(calls.some((c) => c.url === `${V2}/document/e1/content`)).toBe(true);
    });

    it("exports a new version via AddVersion and returns the version id", async () => {
        mockFetch(() => json({ data: { version: 3 } }));
        const content = new TextEncoder().encode("v3").buffer;
        const res = await adapter().exportDocument("e1", content as ArrayBuffer, {
            newVersion: true,
        });
        expect(res).toEqual({ docId: "e1", version: "3" });
        expect(calls[0].url).toBe(`${V2}/document/e1/version`);
        expect(calls[0].init?.method).toBe("POST");
    });

    it("routes egress through the SSRF guard", async () => {
        mockFetch(() => json({ id: "CAB-1" }));
        await adapter().authenticate();
        expect((calls[0].init as RequestInit).redirect).toBe("manual");
        expect(lookupMock).toHaveBeenCalled();
    });
});
