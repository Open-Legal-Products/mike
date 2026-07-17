"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { MikeIcon } from "@/app/components/chat/mike-icon";
import { ChatInput, type ChatInputHandle } from "./ChatInput";
import { SelectAssistantProjectModal } from "./SelectAssistantProjectModal";
import { QuickActionsModal } from "./QuickActionsModal";
import { NewProjectModal } from "../projects/NewProjectModal";
import { NewTRModal } from "../tabular/NewTRModal";
import { createTabularReview } from "@/app/lib/mikeApi";
import { useDirectoryData, type DirectoryTab } from "../shared/useDirectoryData";
import {
    QUICK_ACTIONS,
    type QuickActionId,
    useQuickActionsPreference,
} from "./quickActionsPreferences";
import type { Message, Workflow } from "../shared/types";

interface InitialViewProps {
    onSubmit: (message: Message) => void;
}

const ICON_SIZE = 30;
const GAP = 12; // gap-4 = 1rem = 16px
const DOCUMENT_WORKFLOW_ACTIONS: Partial<
    Record<
        QuickActionId,
        {
            workflowId: string;
            title: string;
            prompt: string;
            initialDocumentTab?: DirectoryTab;
        }
    >
> = {
    proofread: {
        workflowId: "builtin-proofread",
        title: "Proofread",
        prompt: "proofread",
    },
    compareDocuments: {
        workflowId: "builtin-compare-documents",
        title: "Compare Documents",
        prompt: "compare documents",
    },
    extractKeyTerms: {
        workflowId: "builtin-extract-key-terms",
        title: "Extract Key Terms",
        prompt: "extract key terms",
    },
    draftFromTemplate: {
        workflowId: "builtin-draft-from-template",
        title: "Draft from Template",
        prompt: "draft from template",
        initialDocumentTab: "templates",
    },
};

export function InitialView({ onSubmit }: InitialViewProps) {
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const router = useRouter();
    const [loaded, setLoaded] = useState(false);
    const [projectModalOpen, setProjectModalOpen] = useState(false);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [newTROpen, setNewTROpen] = useState(false);
    const [quickActionsModalOpen, setQuickActionsModalOpen] = useState(false);
    const { visibleActions, setVisibleActions } = useQuickActionsPreference();
    const [iconOffset, setIconOffset] = useState(0);
    const [textOffset, setTextOffset] = useState(0);
    const textRef = useRef<HTMLHeadingElement>(null);
    const chatInputRef = useRef<ChatInputHandle>(null);
    const { projects } = useDirectoryData(newTROpen, "projects");

    const username =
        profile?.displayName?.trim() || user?.email?.split("@")[0] || "there";
    const visibleQuickActions = QUICK_ACTIONS.filter(
        (action) => visibleActions[action.id],
    );

    useLayoutEffect(() => {
        if (!profile || !textRef.current) return;
        const h1Width = textRef.current.offsetWidth;
        setIconOffset((h1Width + GAP) / 2);
        setTextOffset((ICON_SIZE + GAP) / 2);
    }, [profile]);

    useEffect(() => {
        if (!iconOffset) return;
        const t = setTimeout(() => setLoaded(true), 100);
        return () => clearTimeout(t);
    }, [iconOffset]);

    function handleDocumentWorkflowClick(id: QuickActionId) {
        const config = DOCUMENT_WORKFLOW_ACTIONS[id];
        if (!config) return;

        chatInputRef.current?.startWorkflowDocumentSelection(
            {
                id: config.workflowId,
                title: config.title,
            },
            config.prompt,
            { initialDocumentTab: config.initialDocumentTab },
        );
    }

    async function handleNewReview(
        title: string,
        projectId?: string,
        documentIds?: string[],
        columnsConfig?: Workflow["columns_config"],
    ) {
        const review = await createTabularReview({
            title,
            document_ids: documentIds ?? [],
            columns_config: columnsConfig ?? [],
            ...(projectId && { project_id: projectId }),
        });
        setNewTROpen(false);
        router.push(
            projectId
                ? `/projects/${projectId}/tabular-reviews/${review.id}`
                : `/tabular-reviews/${review.id}`,
        );
    }

    function handleQuickAction(id: QuickActionId) {
        if (id === "projectChat") {
            setProjectModalOpen(true);
        } else if (DOCUMENT_WORKFLOW_ACTIONS[id]) {
            handleDocumentWorkflowClick(id);
        } else if (id === "newProject") {
            setNewProjectOpen(true);
        } else if (id === "newTabularReview") {
            setNewTROpen(true);
        }
    }

    return (
        <div className="grid h-full w-full grid-rows-[minmax(0,1fr)_auto_minmax(0,1fr)] px-6">
            <div className="flex min-h-0 items-end justify-center pb-6">
                <div className="relative h-10 w-full max-w-4xl px-0 xl:px-8">
                    <div
                        className="absolute h-[30px] w-[30px]"
                        style={{
                            left: "50%",
                            top: "50%",
                            transform: loaded
                                ? `translate(calc(-50% - ${iconOffset}px), -50%)`
                                : "translate(-50%, -50%)",
                            transition:
                                "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94)",
                        }}
                    >
                        <MikeIcon size={ICON_SIZE} />
                    </div>
                    <h1
                        ref={textRef}
                        className="absolute text-4xl font-serif font-light text-gray-900 whitespace-nowrap"
                        style={{
                            left: "50%",
                            top: "50%",
                            transform: loaded
                                ? `translate(calc(-50% + ${textOffset}px), -50%)`
                                : "translate(-50%, -50%)",
                            opacity: loaded ? 1 : 0,
                            transition:
                                "transform 900ms cubic-bezier(0.25, 0.46, 0.45, 0.94), opacity 800ms ease-in-out 300ms",
                        }}
                    >
                        Hi, {username}
                    </h1>
                </div>
            </div>

            <div className="w-full max-w-4xl justify-self-center px-0 xl:px-8">
                <ChatInput
                    ref={chatInputRef}
                    onSubmit={onSubmit}
                    onCancel={() => {}}
                    isLoading={false}
                />
            </div>

            <div className="min-h-0 w-full max-w-4xl justify-self-center px-0 pt-1 xl:px-8">
                <div className="text-center">
                    <p className="text-xs py-2 mb-12 text-gray-500">
                        AI can make mistakes. Answers are not legal advice.
                    </p>
                </div>

                {visibleQuickActions.length > 0 && (
                    <div className="flex flex-col items-center">
                        <div className="group relative flex h-5 items-center justify-center">
                            <span className="flex items-center gap-1.5 text-xs font-medium text-gray-800">
                                <Image
                                    src="/icons/app-sidebar/quick-actions.svg"
                                    alt=""
                                    width={14}
                                    height={14}
                                    unoptimized
                                    aria-hidden="true"
                                    className="h-3.5 w-3.5 shrink-0"
                                />
                                Quick actions
                            </span>
                            <button
                                type="button"
                                onClick={() => setQuickActionsModalOpen(true)}
                                aria-label="Configure quick actions"
                                className="absolute left-full ml-1.5 flex h-5 w-5 items-center justify-center text-gray-400 opacity-0 transition-all hover:text-gray-700 group-hover:opacity-100 focus:opacity-100"
                            >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
                            {visibleQuickActions.map((action) => (
                                <button
                                    key={action.id}
                                    type="button"
                                    onClick={() => handleQuickAction(action.id)}
                                    className="inline-flex h-8 items-center justify-center rounded-full border border-white/70 bg-white/55 px-3 font-medium text-gray-600 shadow-[0_3px_9px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] backdrop-blur-xl transition-all hover:bg-white hover:text-gray-900 active:scale-[0.98] disabled:cursor-default disabled:opacity-45 disabled:active:scale-100"
                                >
                                    {action.label}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            <QuickActionsModal
                open={quickActionsModalOpen}
                onClose={() => setQuickActionsModalOpen(false)}
                visibleActions={visibleActions}
                onVisibleActionsChange={setVisibleActions}
            />

            <SelectAssistantProjectModal
                open={projectModalOpen}
                onClose={() => setProjectModalOpen(false)}
            />
            <NewProjectModal
                open={newProjectOpen}
                onClose={() => setNewProjectOpen(false)}
                onCreated={(project) => {
                    setNewProjectOpen(false);
                    router.push(`/projects/${project.id}`);
                }}
            />
            <NewTRModal
                open={newTROpen}
                onClose={() => setNewTROpen(false)}
                onAdd={handleNewReview}
                projects={projects}
            />
        </div>
    );
}
