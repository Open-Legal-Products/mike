"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useDirectoryData } from "../shared/useDirectoryData";
import { ProjectPicker } from "../shared/ProjectPicker";
import { Modal } from "../shared/Modal";

interface Props {
    open: boolean;
    onClose: () => void;
}

export function SelectAssistantProjectModal({ open, onClose }: Props) {
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const router = useRouter();
    const { saveChat } = useChatHistoryContext();
    const { loading, projects } = useDirectoryData(open);

    useEffect(() => {
        if (!open) return;
        setSelectedId(null);
    }, [open]);

    if (!open) return null;

    async function handleContinue() {
        if (!selectedId) return;
        setCreating(true);
        try {
            const chatId = await saveChat(selectedId);
            if (!chatId) return;
            onClose();
            router.push(`/projects/${selectedId}/assistant/chat/${chatId}`);
        } finally {
            setCreating(false);
        }
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            breadcrumbs={["Assistant", "Start Chat in a Project"]}
            primaryAction={{
                label: creating ? "Creating…" : "Continue",
                onClick: handleContinue,
                disabled: !selectedId || creating,
            }}
        >
            <ProjectPicker
                projects={projects}
                loading={loading}
                selectedId={selectedId}
                onSelect={setSelectedId}
            />
        </Modal>
    );
}
