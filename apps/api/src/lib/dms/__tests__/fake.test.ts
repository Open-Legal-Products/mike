import { beforeEach, describe, expect, it } from "vitest";
import { FakeDMSAdapter } from "../fake";
import {
    getDmsAdapter,
    listDmsAdapters,
    registerDmsAdapter,
    resetDmsRegistryForTests,
} from "../index";
import type { DmsConnector } from "../adapter";

const textDecoder = new TextDecoder();
const decode = (buf: ArrayBuffer) => textDecoder.decode(new Uint8Array(buf));

describe("FakeDMSAdapter", () => {
    let dms: FakeDMSAdapter;

    beforeEach(() => {
        dms = new FakeDMSAdapter();
        dms.seedFolder({ id: "root", name: "Matters", parentId: null });
        dms.seedFolder({ id: "child", name: "Matter 001", parentId: "root" });
        dms.seedDocument({
            id: "doc-1",
            name: "Complaint.pdf",
            folderId: "child",
            content: "complaint body",
        });
        dms.seedDocument({
            id: "doc-2",
            name: "Answer.pdf",
            folderId: "child",
            content: "answer body",
        });
    });

    it("authenticates and reports ready without credentials", async () => {
        expect(dms.enabled).toBe(true);
        await expect(dms.authenticate()).resolves.toEqual({ ok: true });
        await expect(dms.checkReady()).resolves.toMatchObject({ ok: true });
    });

    it("lists folders by parent", async () => {
        const top = await dms.listFolders();
        expect(top.map((f) => f.id)).toEqual(["root"]);
        const children = await dms.listFolders("root");
        expect(children.map((f) => f.id)).toEqual(["child"]);
    });

    it("searches by name and honors folder + limit", async () => {
        const all = await dms.search("");
        expect(all).toHaveLength(2);
        const hit = await dms.search("complaint");
        expect(hit.map((r) => r.id)).toEqual(["doc-1"]);
        expect(hit[0].version).toBe("1");
        const scoped = await dms.search("", { folderId: "child", limit: 1 });
        expect(scoped).toHaveLength(1);
    });

    it("fetches a document with content, metadata and version", async () => {
        const doc = await dms.fetchDocument("doc-1");
        expect(doc).not.toBeNull();
        expect(decode(doc!.content)).toBe("complaint body");
        expect(doc!.version).toBe("1");
        expect(doc!.metadata).toMatchObject({
            id: "doc-1",
            name: "Complaint.pdf",
            extension: "pdf",
            folderId: "child",
        });
        expect(doc!.metadata.sizeBytes).toBe(doc!.content.byteLength);
    });

    it("returns null for a missing document", async () => {
        await expect(dms.fetchDocument("nope")).resolves.toBeNull();
    });

    it("exports a new version and bumps the version id", async () => {
        const encoded = new TextEncoder().encode("edited body");
        const res = await dms.exportDocument(
            "doc-1",
            encoded.buffer.slice(
                encoded.byteOffset,
                encoded.byteOffset + encoded.byteLength,
            ) as ArrayBuffer,
            { newVersion: true },
        );
        expect(res).toEqual({ docId: "doc-1", version: "2" });
        const doc = await dms.fetchDocument("doc-1");
        expect(doc!.version).toBe("2");
        expect(decode(doc!.content)).toBe("edited body");
    });

    it("overwrites in place when newVersion is false", async () => {
        const encoded = new TextEncoder().encode("overwritten");
        await dms.exportDocument(
            "doc-1",
            encoded.buffer.slice(
                encoded.byteOffset,
                encoded.byteOffset + encoded.byteLength,
            ) as ArrayBuffer,
            { newVersion: false },
        );
        const doc = await dms.fetchDocument("doc-1");
        expect(doc!.version).toBe("1");
        expect(decode(doc!.content)).toBe("overwritten");
    });
});

describe("DMS adapter registry", () => {
    beforeEach(() => {
        resetDmsRegistryForTests();
    });

    it("exposes the three built-in kinds", () => {
        expect(listDmsAdapters().sort()).toEqual([
            "fake",
            "imanage",
            "netdocuments",
        ]);
    });

    it("returns the concrete adapter class for a kind", () => {
        const imanage = getDmsAdapter("imanage", {
            baseUrl: "https://tenant.imanage.com",
            customerId: "1",
            library: "ACTIVE",
        });
        expect(imanage.kind).toBe("imanage");
    });

    it("swaps a cloud kind for a Fake without touching callers", async () => {
        // Mirrors storage.test.ts setStorageAdapter: register a replacement
        // factory and observe getDmsAdapter resolve to it.
        const fake = new FakeDMSAdapter();
        fake.seedDocument({ id: "x", name: "X.pdf", content: "x" });
        const swapped: DmsConnector = fake;
        registerDmsAdapter("imanage", () => swapped);

        const resolved = getDmsAdapter("imanage", {
            baseUrl: "https://tenant.imanage.com",
        });
        expect(resolved).toBe(fake);
        const doc = await resolved.fetchDocument("x");
        expect(doc).not.toBeNull();
    });

    it("throws for an unknown kind", () => {
        expect(() =>
            // @ts-expect-error — exercising the runtime guard
            getDmsAdapter("worldox", { baseUrl: "https://x" }),
        ).toThrow(/No DMS adapter registered/);
    });
});
