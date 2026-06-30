import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TRChat } from "@/app/lib/mikeApi";
import { HistoryDropdown } from "./HistoryDropdown";

const chats: TRChat[] = [
    {
        id: "chat-current",
        title: "Current chat",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
    {
        id: "chat-a",
        title: "Liability questions",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
    {
        id: "chat-b",
        title: "Indemnity review",
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    },
];

describe("HistoryDropdown", () => {
    it("lists prior chats but excludes the current one", () => {
        render(
            <HistoryDropdown
                chats={chats}
                currentChatId="chat-current"
                onLoad={vi.fn()}
            />,
        );
        expect(screen.getByText("Liability questions")).toBeInTheDocument();
        expect(screen.getByText("Indemnity review")).toBeInTheDocument();
        expect(screen.queryByText("Current chat")).not.toBeInTheDocument();
    });

    it("shows the empty-state copy when there are no other chats", () => {
        render(
            <HistoryDropdown
                chats={[chats[0]]}
                currentChatId="chat-current"
                onLoad={vi.fn()}
            />,
        );
        expect(screen.getByText("No previous chats.")).toBeInTheDocument();
    });
});
