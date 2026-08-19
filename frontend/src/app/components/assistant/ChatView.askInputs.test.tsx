import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "../shared/types";
import { ChatView } from "./ChatView";

vi.mock("./UserMessage", () => ({ UserMessage: () => null }));
vi.mock("./AssistantMessage", () => ({ AssistantMessage: () => null }));
vi.mock("./ChatInput", () => ({
    ChatInput: () => <div data-testid="chat-input" />,
}));
vi.mock("./AssistantSidePanel", () => ({
    AssistantSidePanel: () => null,
    mergeAssistantSidePanelTab: vi.fn(),
    reorderAssistantSidePanelTabs: vi.fn(),
}));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: () => null,
}));
vi.mock("@/app/contexts/SidebarContext", () => ({
    useSidebar: () => ({ setSidebarOpen: vi.fn() }),
}));
vi.mock("@/app/hooks/useFetchDocxBytes", () => ({
    invalidateDocxBytes: vi.fn(),
}));

// Stands in for the real popup so the test is about ChatView's hide/unhide
// bookkeeping, not about the popup's own form.
vi.mock("./AskInputPopup", () => ({
    AskInputPopup: ({
        onSubmit,
    }: {
        onSubmit?: (
            response: unknown,
            content: string,
            files: unknown[],
        ) => void;
    }) => (
        <button
            type="button"
            data-testid="ask-input-popup"
            onClick={() =>
                onSubmit?.(
                    {
                        type: "ask_inputs_response",
                        responses: [
                            {
                                id: "governing-law",
                                kind: "choice",
                                question: "Which governing law?",
                                answer: "y".repeat(1_400),
                            },
                        ],
                    },
                    "Answers",
                    [],
                )
            }
        >
            answer
        </button>
    ),
}));

const messages: Message[] = [
    { role: "user", content: "Draft it" },
    {
        role: "assistant",
        content: "",
        events: [
            {
                type: "ask_inputs",
                items: [
                    {
                        id: "governing-law",
                        kind: "choice",
                        question: "Which governing law?",
                        options: [{ value: "Singapore" }],
                        allow_other: true,
                        other_label: "Other",
                    },
                ],
            },
        ],
    },
];

function renderChatView(handleChat: () => Promise<string | null>) {
    return render(
        <ChatView
            chatId="chat-1"
            messages={messages}
            isResponseLoading={false}
            handleChat={handleChat}
            cancel={vi.fn()}
        />,
    );
}

class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
}

describe("ChatView ask-inputs submission", () => {
    beforeEach(() => {
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
        Element.prototype.scrollIntoView = vi.fn();
    });

    it("restores the questions when the submit request rejects", async () => {
        // Hiding the card on submit is optimistic and permanent for the
        // session. If the request never reached the server, the user's typed
        // answers are gone with no way back — so a rejection must undo it.
        const handleChat = vi.fn(async () => {
            throw new Error("Failed to fetch");
        });
        renderChatView(handleChat);

        fireEvent.click(screen.getByTestId("ask-input-popup"));
        await waitFor(() => expect(handleChat).toHaveBeenCalledTimes(1));

        await waitFor(() =>
            expect(screen.getByTestId("ask-input-popup")).toBeInTheDocument(),
        );
    });

    it("restores the questions when the submit resolves null (swallowed transport error)", async () => {
        // The shipped useAssistantChat.handleChat does not reject on a
        // transport/stream failure — it catches the error, renders it inline,
        // and resolves null. A guard that only watched for a rejection would
        // miss the most common failure (a down backend), leaving the card
        // hidden and the answers lost. A falsy resolution must restore them too.
        const handleChat = vi.fn(async () => null);
        renderChatView(handleChat);

        fireEvent.click(screen.getByTestId("ask-input-popup"));
        await waitFor(() => expect(handleChat).toHaveBeenCalledTimes(1));

        await waitFor(() =>
            expect(screen.getByTestId("ask-input-popup")).toBeInTheDocument(),
        );
    });

    it("keeps the questions hidden when the submit request succeeds", async () => {
        const handleChat = vi.fn(async () => "chat-1");
        renderChatView(handleChat);

        fireEvent.click(screen.getByTestId("ask-input-popup"));
        await waitFor(() => expect(handleChat).toHaveBeenCalledTimes(1));

        await waitFor(() =>
            expect(screen.queryByTestId("ask-input-popup")).toBeNull(),
        );
        expect(screen.getByTestId("chat-input")).toBeInTheDocument();
    });
});
