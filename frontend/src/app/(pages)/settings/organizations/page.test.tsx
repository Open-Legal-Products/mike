import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import OrganizationsPage from "./page";

const api = vi.hoisted(() => ({
    listOrgs: vi.fn(),
    createOrg: vi.fn(),
    listOrgMembers: vi.fn(),
    listOrgTeams: vi.fn(),
    addOrgMember: vi.fn(),
    updateOrgMember: vi.fn(),
    removeOrgMember: vi.fn(),
    createOrgTeam: vi.fn(),
    deleteOrgTeam: vi.fn(),
    addOrgTeamMember: vi.fn(),
    removeOrgTeamMember: vi.fn(),
    lookupUserByEmail: vi.fn(),
}));

vi.mock("@/app/lib/mikeApi", () => api);
vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "me", email: "me@firm.com" },
        isAuthenticated: true,
        authLoading: false,
    }),
}));

const FIRM = {
    id: "org-1",
    name: "Acme Legal",
    personal: false,
    created_by: "me",
    role: "owner" as const,
};

beforeEach(() => {
    vi.clearAllMocks();
    api.listOrgs.mockResolvedValue([
        FIRM,
        {
            id: "org-personal",
            name: "personal",
            personal: true,
            created_by: "me",
            role: "owner",
        },
    ]);
    api.listOrgMembers.mockResolvedValue([
        {
            id: "m1",
            user_id: "me",
            role: "owner",
            email: "me@firm.com",
            display_name: "Me",
        },
        {
            id: "m2",
            user_id: "u2",
            role: "member",
            email: "colleague@firm.com",
            display_name: "Colleague",
        },
    ]);
    api.listOrgTeams.mockResolvedValue([]);
});

describe("OrganizationsPage", () => {
    it("lists non-personal orgs and hides the personal workspace", async () => {
        render(<OrganizationsPage />);
        expect(await screen.findByText("Acme Legal")).toBeInTheDocument();
        expect(screen.queryByText("personal")).not.toBeInTheDocument();
    });

    it("creates an organization", async () => {
        const user = userEvent.setup();
        api.createOrg.mockResolvedValue({
            id: "org-2",
            name: "New Firm",
            personal: false,
            created_by: "me",
            role: "owner",
        });
        render(<OrganizationsPage />);
        await screen.findByText("Acme Legal");

        await user.type(
            screen.getByPlaceholderText("New organization name…"),
            "New Firm",
        );
        await user.click(
            screen.getByRole("button", { name: /create organization/i }),
        );

        expect(api.createOrg).toHaveBeenCalledWith("New Firm");
        expect(await screen.findByText("New Firm")).toBeInTheDocument();
    });

    it("expands an org, shows the enriched roster and changes a role", async () => {
        const user = userEvent.setup();
        api.updateOrgMember.mockResolvedValue({});
        render(<OrganizationsPage />);

        await user.click(await screen.findByText("Acme Legal"));
        expect(await screen.findByText(/Colleague/)).toBeInTheDocument();
        expect(screen.getByText("(You)")).toBeInTheDocument();

        await user.selectOptions(
            screen.getByLabelText("Role for Colleague"),
            "admin",
        );
        await waitFor(() =>
            expect(api.updateOrgMember).toHaveBeenCalledWith(
                "org-1",
                "u2",
                "admin",
            ),
        );
    });

    it("surfaces server errors like last-owner protection inline", async () => {
        const user = userEvent.setup();
        api.updateOrgMember.mockRejectedValue(
            new Error("An organization must keep at least one owner."),
        );
        render(<OrganizationsPage />);

        await user.click(await screen.findByText("Acme Legal"));
        await user.selectOptions(
            await screen.findByLabelText("Role for Colleague"),
            "admin",
        );

        expect(
            await screen.findByText(
                "An organization must keep at least one owner.",
            ),
        ).toBeInTheDocument();
    });

    it("hides management affordances for plain members", async () => {
        const user = userEvent.setup();
        api.listOrgs.mockResolvedValue([
            { ...FIRM, role: "member" as const },
        ]);
        render(<OrganizationsPage />);

        await user.click(await screen.findByText("Acme Legal"));
        await screen.findByText(/Colleague/);
        expect(
            screen.queryByPlaceholderText("Add a colleague by email…"),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByLabelText("Role for Colleague"),
        ).not.toBeInTheDocument();
    });
});
