import { describe, expect, it } from "vitest";
import {
    can,
    roleFrom,
    type Capability,
    type ProjectRole,
} from "./permissions";

// Mirror of the backend matrix (backend/src/lib/permissions.ts) — cell by
// cell so any drift between client and server policy is a visible diff.
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

describe("permissions matrix (client mirror)", () => {
    for (const [role, caps] of Object.entries(EXPECTED)) {
        for (const [capability, allowed] of Object.entries(caps)) {
            it(`${role} ${allowed ? "can" : "cannot"} ${capability}`, () => {
                expect(
                    can(role as ProjectRole, capability as Capability),
                ).toBe(allowed);
            });
        }
    }

    it("fails closed on missing roles", () => {
        expect(can(null, "project.view")).toBe(false);
        expect(can(undefined, "container.delete")).toBe(false);
    });
});

describe("roleFrom", () => {
    it("prefers access_role from detail responses", () => {
        expect(roleFrom({ access_role: "viewer", is_owner: false })).toBe(
            "viewer",
        );
        expect(roleFrom({ access_role: "manager", is_owner: false })).toBe(
            "manager",
        );
    });

    it("falls back to the is_owner list-row contract", () => {
        expect(roleFrom({ is_owner: true })).toBe("owner");
        expect(roleFrom({ is_owner: false })).toBe("editor");
    });

    it("fails closed when a row carries neither field", () => {
        // Bare mutation responses (PATCH handlers return the raw DB row)
        // have neither access_role nor is_owner. Defaulting to "owner"
        // here once let a manager's client gates silently open after a
        // column save; the unknown case must resolve to the weakest role.
        expect(roleFrom({})).toBe("viewer");
        expect(roleFrom({ access_role: null, is_owner: null })).toBe("viewer");
    });

    it("ignores unknown access_role values", () => {
        expect(
            roleFrom({
                access_role: "superuser" as never,
                is_owner: false,
            }),
        ).toBe("editor");
    });
});
