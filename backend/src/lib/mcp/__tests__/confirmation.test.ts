import { describe, expect, it } from "vitest";
import {
    connectorTrustsAnnotations,
    mcpCallNeedsApproval,
    toolRequiresConfirmation,
    toolRowRequiresConfirmation,
} from "../client";

// Fail-safe confirmation policy for legal data: a tool's annotations are only
// "positively safe" when the server EXPLICITLY declares readOnlyHint: true AND
// openWorldHint: false, without an explicit destructive claim. The MCP spec
// says an omitted openWorldHint defaults to TRUE, so absence of the hint must
// never count as safety. And because annotations are server-controlled, even
// positively-safe tools still need the user's local trust decision on the
// connector before they may run without per-call approval.
describe("toolRequiresConfirmation (annotation classification)", () => {
    describe("ambiguous / missing annotations require confirmation", () => {
        it("no annotations object at all → confirmation required", () => {
            expect(toolRequiresConfirmation(undefined)).toBe(true);
            expect(toolRequiresConfirmation(null)).toBe(true);
        });

        it("empty annotations (no hints) → confirmation required", () => {
            expect(toolRequiresConfirmation({})).toBe(true);
        });

        it("readOnlyHint merely absent (other hints present) → confirmation required", () => {
            expect(toolRequiresConfirmation({ openWorldHint: false })).toBe(true);
        });

        it("openWorldHint merely absent → confirmation required (spec default is open-world)", () => {
            // Per the MCP spec an omitted openWorldHint defaults to true, so
            // { readOnlyHint: true } alone is an open-world reader and gated.
            expect(toolRequiresConfirmation({ readOnlyHint: true })).toBe(true);
        });

        it("readOnlyHint not a strict true (e.g. truthy string) → confirmation required", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: "true",
                    openWorldHint: false,
                }),
            ).toBe(true);
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: 1,
                    openWorldHint: false,
                }),
            ).toBe(true);
        });

        it("openWorldHint not a strict false (e.g. falsy 0) → confirmation required", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    openWorldHint: 0,
                }),
            ).toBe(true);
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    openWorldHint: "false",
                }),
            ).toBe(true);
        });
    });

    describe("positively-declared safe annotations skip confirmation", () => {
        it("readOnlyHint===true AND openWorldHint===false → no confirmation", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    openWorldHint: false,
                }),
            ).toBe(false);
        });

        it("explicit false destructiveHint alongside → no confirmation", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    destructiveHint: false,
                    openWorldHint: false,
                }),
            ).toBe(false);
        });
    });

    describe("known-unsafe signals still require confirmation", () => {
        it("destructiveHint true (even if read-only + closed-world claimed) → confirmation required", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    destructiveHint: true,
                    openWorldHint: false,
                }),
            ).toBe(true);
        });

        it("openWorldHint true even with readOnlyHint true → confirmation required", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    openWorldHint: true,
                }),
            ).toBe(true);
        });

        it("readOnlyHint explicitly false → confirmation required", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: false,
                    openWorldHint: false,
                }),
            ).toBe(true);
        });
    });
});

describe("toolRowRequiresConfirmation (cached rows must not weaken the gate)", () => {
    it("stale cached false with gating annotations → still requires confirmation", () => {
        // A row classified under an older, lenient policy: the column says
        // "no confirmation" but the annotations are empty/ambiguous, which the
        // fail-safe policy gates. The live recomputation must win.
        expect(
            toolRowRequiresConfirmation({
                requires_confirmation: false,
                annotations: {},
            }),
        ).toBe(true);
        expect(
            toolRowRequiresConfirmation({
                requires_confirmation: false,
                annotations: null,
            }),
        ).toBe(true);
        expect(
            toolRowRequiresConfirmation({
                requires_confirmation: false,
                annotations: { readOnlyHint: true }, // open-world by default
            }),
        ).toBe(true);
    });

    it("cached true is honored even when annotations look safe", () => {
        // A stored "gate this" can never be silently downgraded.
        expect(
            toolRowRequiresConfirmation({
                requires_confirmation: true,
                annotations: { readOnlyHint: true, openWorldHint: false },
            }),
        ).toBe(true);
    });

    it("cached false with positively-safe annotations → no confirmation", () => {
        expect(
            toolRowRequiresConfirmation({
                requires_confirmation: false,
                annotations: { readOnlyHint: true, openWorldHint: false },
            }),
        ).toBe(false);
    });
});

describe("connectorTrustsAnnotations (the user's local trust decision)", () => {
    it("defaults to untrusted for missing/empty/other policies", () => {
        expect(connectorTrustsAnnotations(undefined)).toBe(false);
        expect(connectorTrustsAnnotations(null)).toBe(false);
        expect(connectorTrustsAnnotations({})).toBe(false);
        expect(connectorTrustsAnnotations({ other: true })).toBe(false);
    });

    it("only a strict boolean true counts", () => {
        expect(connectorTrustsAnnotations({ trust_annotations: true })).toBe(true);
        expect(connectorTrustsAnnotations({ trust_annotations: "true" })).toBe(false);
        expect(connectorTrustsAnnotations({ trust_annotations: 1 })).toBe(false);
        expect(connectorTrustsAnnotations({ trust_annotations: false })).toBe(false);
    });
});

describe("mcpCallNeedsApproval (auto-run needs BOTH signals)", () => {
    it("safe annotations on an untrusted connector → per-call approval", () => {
        // Annotations are server-controlled; a lying server must not be able
        // to grant itself auto-execution on a connector the user never vetted.
        expect(
            mcpCallNeedsApproval({
                requiresConfirmation: false,
                toolPolicy: {},
            }),
        ).toBe(true);
    });

    it("trusted connector but unsafe/ambiguous annotations → per-call approval", () => {
        expect(
            mcpCallNeedsApproval({
                requiresConfirmation: true,
                toolPolicy: { trust_annotations: true },
            }),
        ).toBe(true);
    });

    it("trusted connector AND positively-safe annotations → auto-run", () => {
        expect(
            mcpCallNeedsApproval({
                requiresConfirmation: false,
                toolPolicy: { trust_annotations: true },
            }),
        ).toBe(false);
    });

    it("untrusted connector AND unsafe annotations → per-call approval", () => {
        expect(
            mcpCallNeedsApproval({
                requiresConfirmation: true,
                toolPolicy: null,
            }),
        ).toBe(true);
    });
});
