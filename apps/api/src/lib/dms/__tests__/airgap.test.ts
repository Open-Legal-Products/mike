import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// servers.ts → lib/storage → lib/env validates process.env at import; stub it.
vi.mock("../../env", async () => ({
    env: (await import("./fakeEnv")).fakeEnv,
}));

import { createDmsConnector, resolveDmsAdapter } from "../servers";
import { getDmsAdapter } from "../index";
import { sharedFakeDms } from "../fake";
import type { DmsConnectorRow } from "../types";

// The airgap guard reads process.env.AIRGAPPED at call time (lib/airgap.ts).
const priorAirgap = process.env.AIRGAPPED;

function row(kind: DmsConnectorRow["kind"]): DmsConnectorRow {
    return {
        id: "c1",
        user_id: "u1",
        kind,
        name: "Test",
        base_url: "https://tenant.example.com",
        auth_type: "oauth",
        enabled: true,
        encrypted_auth_config: null,
        auth_config_iv: null,
        auth_config_tag: null,
        config: { customer_id: "1", library: "ACTIVE", repository: "CAB" },
        created_at: "now",
        updated_at: "now",
    };
}

// A db stub is never reached: the airgap guard throws before any query.
const db = {} as never;

beforeEach(() => {
    process.env.AIRGAPPED = "true";
    sharedFakeDms.reset();
});

afterEach(() => {
    if (priorAirgap === undefined) delete process.env.AIRGAPPED;
    else process.env.AIRGAPPED = priorAirgap;
});

describe("DMS air-gap gating", () => {
    it("refuses to create an iManage connector when air-gapped", async () => {
        await expect(
            createDmsConnector(
                "u1",
                { kind: "imanage", name: "x", baseUrl: "https://t.imanage.com" },
                db,
            ),
        ).rejects.toThrow(/air-gapped/);
    });

    it("refuses to create a NetDocuments connector when air-gapped", async () => {
        await expect(
            createDmsConnector(
                "u1",
                {
                    kind: "netdocuments",
                    name: "x",
                    baseUrl: "https://t.netdocuments.com",
                },
                db,
            ),
        ).rejects.toThrow(/air-gapped/);
    });

    it("refuses to resolve a cloud adapter when air-gapped", () => {
        expect(() => resolveDmsAdapter(row("imanage"), db)).toThrow(
            /air-gapped/,
        );
        expect(() => resolveDmsAdapter(row("netdocuments"), db)).toThrow(
            /air-gapped/,
        );
    });

    it("keeps the in-memory Fake connector fully usable air-gapped", async () => {
        // The Fake has no egress, so it is allowed even when AIRGAPPED=true.
        const adapter = resolveDmsAdapter(row("fake"), db);
        expect(adapter.kind).toBe("fake");
        sharedFakeDms.seedDocument({
            id: "d1",
            name: "Local.pdf",
            content: "offline",
        });
        const doc = await adapter.fetchDocument("d1");
        expect(doc).not.toBeNull();
        await expect(adapter.authenticate()).resolves.toEqual({ ok: true });
    });

    it("still allows creating a Fake connector air-gapped (guard is per-kind)", () => {
        // getDmsAdapter for the fake kind is not gated.
        const adapter = getDmsAdapter("fake", { baseUrl: "https://fake.invalid" });
        expect(adapter.kind).toBe("fake");
    });
});
