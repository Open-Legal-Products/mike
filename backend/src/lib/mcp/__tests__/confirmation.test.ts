import { describe, expect, it } from "vitest";
import { toolRequiresConfirmation } from "../client";

// Fail-safe confirmation policy for legal data: a tool is gated behind human
// confirmation UNLESS it is POSITIVELY known-safe (readOnlyHint === true AND
// not destructive AND not open-world). Absent/ambiguous annotations must
// default to REQUIRING confirmation.
describe("toolRequiresConfirmation (fail-safe policy)", () => {
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

        it("readOnlyHint not a strict true (e.g. truthy string) → confirmation required", () => {
            expect(toolRequiresConfirmation({ readOnlyHint: "true" })).toBe(true);
            expect(toolRequiresConfirmation({ readOnlyHint: 1 })).toBe(true);
        });
    });

    describe("positively known-safe tools skip confirmation", () => {
        it("readOnlyHint===true and no destructive/open-world → no confirmation", () => {
            expect(toolRequiresConfirmation({ readOnlyHint: true })).toBe(false);
        });

        it("readOnlyHint===true with explicit false destructive/open-world → no confirmation", () => {
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
        it("destructiveHint true (even if read-only claimed) → confirmation required", () => {
            expect(
                toolRequiresConfirmation({
                    readOnlyHint: true,
                    destructiveHint: true,
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
            expect(toolRequiresConfirmation({ readOnlyHint: false })).toBe(true);
        });
    });
});
