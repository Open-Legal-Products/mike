import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Agent } from "undici";

// Mock DNS resolution so the SSRF guard is exercised deterministically without
// touching the network. `lookupMock` is hoisted so the vi.mock factory can
// reference it.
const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));
vi.mock("dns/promises", () => ({
    default: { lookup: lookupMock },
}));

import { guardedFetch, validateRemoteMcpUrl } from "../client";

function resolvesTo(...addresses: string[]) {
    lookupMock.mockResolvedValue(
        addresses.map((address) => ({
            address,
            family: address.includes(":") ? 6 : 4,
        })),
    );
}

beforeEach(() => {
    lookupMock.mockReset();
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe("validateRemoteMcpUrl", () => {
    it("rejects non-HTTPS URLs", async () => {
        await expect(validateRemoteMcpUrl("http://example.com/")).rejects.toThrow(
            /HTTPS/,
        );
    });

    it("rejects invalid URLs", async () => {
        await expect(validateRemoteMcpUrl("not a url")).rejects.toThrow(
            /valid URL/,
        );
    });

    it("rejects localhost and metadata hosts without a DNS lookup", async () => {
        for (const host of [
            "https://localhost/",
            "https://foo.localhost/",
            "https://metadata.google.internal/",
            "https://instance-data/",
        ]) {
            await expect(validateRemoteMcpUrl(host), host).rejects.toThrow(
                /blocked host/,
            );
        }
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it("rejects private IPv4/IPv6 literals without a DNS lookup", async () => {
        for (const host of [
            "https://127.0.0.1/",
            "https://10.0.0.1/",
            "https://169.254.169.254/",
            "https://[::1]/",
            "https://[fd00::1]/",
            "https://[fec0::1]/",
            "https://[ff02::1]/",
            "https://[100::1]/",
            "https://[2001:db8::1]/",
            "https://[3fff::1]/",
            "https://[64:ff9b:1::1]/",
            // IPv4-compatible ::/96 embeds (deprecated per RFC 4291 but still
            // parseable) — `::127.0.0.1` in hex, uncompressed, and dotted forms
            "https://[::7f00:1]/",
            "https://[0:0:0:0:0:0:7f00:1]/",
            "https://[::10.0.0.1]/",
        ]) {
            await expect(validateRemoteMcpUrl(host), host).rejects.toThrow(
                /blocked network address/,
            );
        }
        expect(lookupMock).not.toHaveBeenCalled();
    });

    it("rejects a hostname that resolves to a private address", async () => {
        resolvesTo("10.0.0.5");
        await expect(
            validateRemoteMcpUrl("https://rebind.example.com/"),
        ).rejects.toThrow(/blocked network address/);
    });

    it("rejects when ANY resolved address is private (mixed record set)", async () => {
        resolvesTo("93.184.216.34", "192.168.1.1");
        await expect(
            validateRemoteMcpUrl("https://mixed.example.com/"),
        ).rejects.toThrow(/blocked network address/);
    });

    it("accepts a public host and strips credentials/hash", async () => {
        resolvesTo("93.184.216.34");
        const out = await validateRemoteMcpUrl(
            "https://user:secret@public.example.com/path?q=1#frag",
        );
        expect(out).toBe("https://public.example.com/path?q=1");
        expect(out).not.toContain("secret");
        expect(out).not.toContain("frag");
    });
});

describe("guardedFetch", () => {
    it("throws and never calls fetch when the URL fails validation", async () => {
        resolvesTo("10.0.0.5");
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        await expect(
            guardedFetch("https://rebind.example.com/"),
        ).rejects.toThrow(/blocked network address/);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reuses a pinned dispatcher and disables redirects for public hosts", async () => {
        resolvesTo("93.184.216.34");
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response("ok", { status: 200 }));

        const res = await guardedFetch("https://public.example.com/x", {
            method: "GET",
        });
        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(1);

        const init = fetchSpy.mock.calls[0][1] as RequestInit & {
            dispatcher?: unknown;
        };
        expect(init.redirect).toBe("manual");
        expect(init.dispatcher).toBeInstanceOf(Agent);
        // Original request options are preserved.
        expect(init.method).toBe("GET");

        await guardedFetch("https://public.example.com/y");
        const nextInit = fetchSpy.mock.calls[1][1] as RequestInit & {
            dispatcher?: unknown;
        };
        expect(nextInit.dispatcher).toBe(init.dispatcher);
    });

    it("follows redirects hop by hop, re-validating each target", async () => {
        resolvesTo("93.184.216.34");
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: "/metadata/.well-known/oauth-protected-resource" },
                }),
            )
            .mockResolvedValueOnce(new Response("{}", { status: 200 }));

        const res = await guardedFetch(
            "https://public.example.com/.well-known/oauth-protected-resource",
        );
        expect(res.status).toBe(200);
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        expect(String(fetchSpy.mock.calls[1][0])).toBe(
            "https://public.example.com/metadata/.well-known/oauth-protected-resource",
        );
    });

    it("refuses to follow a redirect to a blocked address", async () => {
        lookupMock
            .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }])
            .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: "https://evil.example.com/" },
                }),
            );

        await expect(
            guardedFetch("https://public.example.com/"),
        ).rejects.toThrow(/blocked network address/);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("strips credentials when a redirect crosses origins", async () => {
        resolvesTo("93.184.216.34");
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 302,
                    headers: { location: "https://other.example.com/meta" },
                }),
            )
            .mockResolvedValueOnce(new Response("{}", { status: 200 }));

        await guardedFetch("https://public.example.com/", {
            headers: { authorization: "Bearer secret" },
        });
        const secondInit = fetchSpy.mock.calls[1][1] as RequestInit;
        expect(new Headers(secondInit.headers).get("authorization")).toBeNull();
    });

    it("converts a redirected POST to GET and drops the body", async () => {
        resolvesTo("93.184.216.34");
        const fetchSpy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValueOnce(
                new Response(null, {
                    status: 303,
                    headers: { location: "/done" },
                }),
            )
            .mockResolvedValueOnce(new Response("{}", { status: 200 }));

        await guardedFetch("https://public.example.com/register", {
            method: "POST",
            body: "{}",
        });
        const secondInit = fetchSpy.mock.calls[1][1] as RequestInit;
        expect(secondInit.method).toBe("GET");
        expect(secondInit.body).toBeUndefined();
    });
});
