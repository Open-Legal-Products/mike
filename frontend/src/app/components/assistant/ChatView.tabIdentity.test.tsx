import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditAnnotation, Message } from "../shared/types";

// jsdom ships no ResizeObserver; ChatView measures its composer with one.
globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

// Only the version list is faked; the resolver under test is the real one.
const listDocumentVersions = vi.fn();
vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    listDocumentVersions: (documentId: string) =>
        listDocumentVersions(documentId),
}));

// The panel's viewers, the composer and the modals all reach for browser APIs
// jsdom does not provide and are irrelevant here — the assertion is about
// which TAB IDS ChatView produces, so the panel is replaced by a tab listing.
vi.mock("./AssistantSidePanel", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./AssistantSidePanel")>()),
    AssistantSidePanel: ({
        tabs,
    }: {
        tabs: { id: string }[];
    }) => (
        <ul data-testid="tabs">
            {tabs.map((tab) => (
                <li key={tab.id}>{tab.id}</li>
            ))}
        </ul>
    ),
}));

vi.mock("./ChatInput", () => ({
    ChatInput: () => <div />,
}));
vi.mock("./AskInputPopup", () => ({ AskInputPopup: () => <div /> }));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: () => <div />,
}));

const EDIT: EditAnnotation = {
    id: "edit-1",
    document_id: "document-1",
    filename: "agreement.docx",
    // Legacy annotation: persisted before edits recorded the version they
    // were authored against, so the FK columns are null.
    version_id: null,
    version_number: null,
} as unknown as EditAnnotation;

// Two entry points into the same document version: a download card that
// names no version, and an edit card whose annotation names no version.
vi.mock("./AssistantMessage", () => ({
    AssistantMessage: ({
        onOpenDocument,
        onEditViewClick,
    }: {
        onOpenDocument: (args: {
            documentId: string;
            filename: string;
            versionId: string | null;
            versionNumber: number | null;
        }) => void;
        onEditViewClick: (ann: EditAnnotation, filename: string) => void;
    }) => (
        <div>
            <button
                onClick={() =>
                    onOpenDocument({
                        documentId: "document-1",
                        filename: "agreement.docx",
                        versionId: null,
                        versionNumber: null,
                    })
                }
            >
                open document
            </button>
            <button onClick={() => onEditViewClick(EDIT, "agreement.docx")}>
                open edit
            </button>
        </div>
    ),
}));

const { ChatView } = await import("./ChatView");

const MESSAGES: Message[] = [
    { id: "m1", role: "assistant", content: "", events: [] },
];

function renderChatView() {
    return render(
        <ChatView
            messages={MESSAGES}
            isResponseLoading={false}
            handleChat={vi.fn().mockResolvedValue(null)}
            cancel={vi.fn()}
        />,
    );
}

describe("ChatView panel tab identity", () => {
    beforeEach(() => {
        listDocumentVersions.mockReset();
        listDocumentVersions.mockResolvedValue({
            current_version_id: "version-3",
            versions: [
                {
                    id: "version-3",
                    version_number: 3,
                    source: "assistant_edit",
                    created_at: "2026-08-18T00:00:00Z",
                    filename: "agreement.docx",
                    deleted_at: null,
                },
            ],
        });
    });

    // V3: openEditor used to build its tab id straight from the annotation,
    // so a legacy edit keyed "document-1::current" while every resolved link
    // to the same bytes keyed "document-1::id:version-3" — two tabs, one
    // document version, identical content.
    it("opens a legacy edit into the same tab as the resolved document", async () => {
        const user = userEvent.setup();
        renderChatView();

        await user.click(screen.getByText("open document"));
        expect(await screen.findByText("document-1::id:version-3")).toBeTruthy();

        await user.click(screen.getByText("open edit"));

        const tabs = await screen.findByTestId("tabs");
        expect(
            Array.from(tabs.querySelectorAll("li")).map((li) => li.textContent),
        ).toEqual(["document-1::id:version-3"]);
    });
});
