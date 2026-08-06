import { describe, expect, it } from "vitest";
import { can, type Capability, type ProjectRole } from "../permissions";

// The full role × capability matrix, asserted cell by cell so any edit to
// the policy table is a visible diff here.
const EXPECTED: Record<ProjectRole, Record<Capability, boolean>> = {
    viewer: {
        "project.view": true,
        "content.edit": false,
        "docs.organize": false,
        "structure.manage": false,
        "members.manage": false,
        "container.delete": false,
    },
    editor: {
        "project.view": true,
        "content.edit": true,
        "docs.organize": true,
        "structure.manage": false,
        "members.manage": false,
        "container.delete": false,
    },
    manager: {
        "project.view": true,
        "content.edit": true,
        "docs.organize": true,
        "structure.manage": true,
        "members.manage": true,
        "container.delete": false,
    },
    owner: {
        "project.view": true,
        "content.edit": true,
        "docs.organize": true,
        "structure.manage": true,
        "members.manage": true,
        "container.delete": true,
    },
};

describe("permissions matrix", () => {
    for (const [role, caps] of Object.entries(EXPECTED)) {
        for (const [capability, allowed] of Object.entries(caps)) {
            it(`${role} ${allowed ? "can" : "cannot"} ${capability}`, () => {
                expect(
                    can(role as ProjectRole, capability as Capability),
                ).toBe(allowed);
            });
        }
    }

    it("fails closed on missing or unknown roles", () => {
        expect(can(null, "project.view")).toBe(false);
        expect(can(undefined, "project.view")).toBe(false);
        expect(can("admin" as ProjectRole, "project.view")).toBe(false);
    });
});
