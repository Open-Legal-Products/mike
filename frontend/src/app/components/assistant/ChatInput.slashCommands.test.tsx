import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listWorkflows } from "@/app/lib/mikeApi";
import type { Workflow } from "../shared/types";
import { ChatInput } from "./ChatInput";

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(),
    uploadProjectDocument: vi.fn(),
    uploadStandaloneDocument: vi.fn(),
}));

vi.mock("@/app/hooks/useSelectedModel", () => ({
    useSelectedModel: () => ["claude-sonnet-4-6", vi.fn()],
    useReasoningEffort: () => ["medium", vi.fn()],
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: () => ({ profile: null }),
}));

vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));

vi.mock("./AddDocButton", () => ({ AddDocButton: () => null }));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({
    AddDocumentsModal: () => null,
}));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: () => null,
}));
vi.mock("../popups/ApiKeyMissingPopup", () => ({
    ApiKeyMissingPopup: () => null,
}));
vi.mock("./ModelToggle", () => ({ ModelToggle: () => null }));

const workflow = {
    id: "workflow-1",
    metadata: {
        name: "contract-intake",
        title: "Contract Intake",
    },
} as Workflow;

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

describe("ChatInput workflow slash commands", () => {
    beforeEach(() => {
        vi.mocked(listWorkflows).mockResolvedValue([workflow]);
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    it("attaches the selected workflow without submitting", async () => {
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(
            <ChatInput
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        const input = screen.getByRole("combobox");
        await user.type(input, "/cont");
        await screen.findByRole("option", {
            name: "/contract-intake Contract Intake",
        });
        await user.keyboard("{Enter}");

        expect(onSubmit).not.toHaveBeenCalled();
        expect(input).toHaveValue("");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(screen.getByText("Contract Intake")).toBeInTheDocument();

        await user.type(input, "Review this agreement");
        await user.keyboard("{Enter}");

        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    role: "user",
                    content: "Review this agreement",
                    workflow: {
                        id: "workflow-1",
                        title: "Contract Intake",
                    },
                }),
            ),
        );
    });

    it("treats slash as ordinary input when no workflows define commands", async () => {
        let resolveWorkflows!: (workflows: Workflow[]) => void;
        vi.mocked(listWorkflows).mockReturnValue(
            new Promise((resolve) => {
                resolveWorkflows = resolve;
            }),
        );
        const workflowsWithoutCommands = [
            {
                ...workflow,
                metadata: {
                    ...workflow.metadata,
                    name: null,
                },
            } as Workflow,
        ];
        const onSubmit = vi.fn();
        const user = userEvent.setup();
        render(
            <ChatInput
                onSubmit={onSubmit}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        const input = screen.getByRole("combobox");
        await user.type(input, "/");

        expect(input).toHaveValue("/");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();

        await act(async () => {
            resolveWorkflows(workflowsWithoutCommands);
        });

        expect(input).toHaveValue("/");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(screen.queryByRole("status")).not.toBeInTheDocument();

        await user.keyboard("{Enter}");

        await waitFor(() =>
            expect(onSubmit).toHaveBeenCalledWith(
                expect.objectContaining({
                    role: "user",
                    content: "/",
                    workflow: undefined,
                }),
            ),
        );
    });
});
