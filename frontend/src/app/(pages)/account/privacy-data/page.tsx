"use client";

import { useState } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    MfaVerificationPopup,
    needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import {
    deleteAllChats,
    deleteAllProjects,
    deleteAllTabularReviews,
    exportAccountData,
    exportChatData,
    exportTabularReviewsData,
    isMfaRequiredError,
} from "@/app/lib/mikeApi";
import {
    accountGlassDangerOutlineButtonClassName,
    accountGlassPrimaryButtonClassName,
} from "../accountStyles";
import { AccountSection } from "../AccountSection";

type DeleteDataAction = "chats" | "tabular-reviews" | "projects";
type ExportDataAction = "export-chats" | "export-tabular-reviews" | "export-account";
type MfaRetryAction = DeleteDataAction | ExportDataAction;

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

const DELETE_DATA_COPY: Record<
    DeleteDataAction,
    {
        title: string;
        message: string;
    }
> = {
    chats: {
        title: "Delete all chats?",
        message:
            "This will permanently delete your assistant and tabular review chat history. This action cannot be undone.",
    },
    "tabular-reviews": {
        title: "Delete all tabular reviews?",
        message:
            "This will permanently delete all tabular reviews you own, including their cells and review chats. This action cannot be undone.",
    },
    projects: {
        title: "Delete all projects?",
        message:
            "This will permanently delete all projects you own, including their documents, chats, and tabular reviews. This action cannot be undone.",
    },
};

export default function PrivacyDataPage() {
    const { loadChats, setCurrentChatId } = useChatHistoryContext();
    const [pendingDeleteAction, setPendingDeleteAction] =
        useState<DeleteDataAction | null>(null);
    const [deletingAction, setDeletingAction] =
        useState<DeleteDataAction | null>(null);
    const [pendingMfaAction, setPendingMfaAction] =
        useState<MfaRetryAction | null>(null);
    const [isExportingAccount, setIsExportingAccount] = useState(false);
    const [isExportingChats, setIsExportingChats] = useState(false);
    const [isExportingTabularReviews, setIsExportingTabularReviews] =
        useState(false);

    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handleExportAccountData = async () => {
        devLog("[privacy-data/mfa] export account requested");
        setIsExportingAccount(true);
        try {
            if (await needsMfaVerification()) {
                setPendingMfaAction("export-account");
                return;
            }
            const { blob, filename } = await exportAccountData();
            downloadBlob(blob, filename ?? "mike-account-export.json");
        } catch (error) {
            devLog("[privacy-data/mfa] export account failed", {
                isMfaRequired: isMfaRequiredError(error),
                error,
            });
            if (isMfaRequiredError(error)) {
                setPendingMfaAction("export-account");
                return;
            }
            alert("Failed to export account data. Please try again.");
        } finally {
            setIsExportingAccount(false);
        }
    };

    const handleExportChatData = async () => {
        devLog("[privacy-data/mfa] export chats requested");
        setIsExportingChats(true);
        try {
            if (await needsMfaVerification()) {
                setPendingMfaAction("export-chats");
                return;
            }
            const { blob, filename } = await exportChatData();
            downloadBlob(blob, filename ?? "mike-chat-export.json");
        } catch (error) {
            devLog("[privacy-data/mfa] export chats failed", {
                isMfaRequired: isMfaRequiredError(error),
                error,
            });
            if (isMfaRequiredError(error)) {
                setPendingMfaAction("export-chats");
                return;
            }
            alert("Failed to export chats. Please try again.");
        } finally {
            setIsExportingChats(false);
        }
    };

    const handleExportTabularReviewsData = async () => {
        devLog("[privacy-data/mfa] export tabular reviews requested");
        setIsExportingTabularReviews(true);
        try {
            if (await needsMfaVerification()) {
                setPendingMfaAction("export-tabular-reviews");
                return;
            }
            const { blob, filename } = await exportTabularReviewsData();
            downloadBlob(blob, filename ?? "mike-tabular-reviews-export.json");
        } catch (error) {
            devLog("[privacy-data/mfa] export tabular reviews failed", {
                isMfaRequired: isMfaRequiredError(error),
                error,
            });
            if (isMfaRequiredError(error)) {
                setPendingMfaAction("export-tabular-reviews");
                return;
            }
            alert("Failed to export tabular reviews. Please try again.");
        } finally {
            setIsExportingTabularReviews(false);
        }
    };

    const handleDeleteData = async (action: DeleteDataAction) => {
        devLog("[privacy-data/mfa] delete requested", { action });
        setDeletingAction(action);
        try {
            if (await needsMfaVerification()) {
                setPendingDeleteAction(null);
                setPendingMfaAction(action);
                return;
            }
            if (action === "chats") {
                await deleteAllChats();
                setCurrentChatId(null);
                await loadChats();
            } else if (action === "tabular-reviews") {
                await deleteAllTabularReviews();
            } else {
                await deleteAllProjects();
                setCurrentChatId(null);
                await loadChats();
            }
            setPendingDeleteAction(null);
        } catch (error) {
            devLog("[privacy-data/mfa] delete failed", {
                action,
                isMfaRequired: isMfaRequiredError(error),
                error,
            });
            if (isMfaRequiredError(error)) {
                setPendingDeleteAction(null);
                setPendingMfaAction(action);
                return;
            }
            alert("Failed to delete data. Please try again.");
        } finally {
            setDeletingAction(null);
        }
    };

    const handleMfaVerified = async () => {
        const action = pendingMfaAction;
        devLog("[privacy-data/mfa] verification callback", { action });
        setPendingMfaAction(null);
        if (!action) return;

        if (action === "export-account") {
            await handleExportAccountData();
        } else if (action === "export-chats") {
            await handleExportChatData();
        } else if (action === "export-tabular-reviews") {
            await handleExportTabularReviewsData();
        } else {
            await handleDeleteData(action);
        }
    };

    const pendingDeleteCopy = pendingDeleteAction
        ? DELETE_DATA_COPY[pendingDeleteAction]
        : null;

    return (
        <div className="space-y-8">
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Export data
                </h2>
                <AccountSection>
                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Export chats
                            </p>
                            <p className="text-sm text-gray-500">
                                Download assistant and tabular review chat
                                history as JSON.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleExportChatData}
                            disabled={isExportingChats}
                            className={`h-9 gap-1.5 text-sm ${accountGlassPrimaryButtonClassName}`}
                        >
                            {!isExportingChats && (
                                <Download className="h-4 w-4 shrink-0" />
                            )}
                            {isExportingChats ? "Exporting..." : "Export"}
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Export tabular reviews
                            </p>
                            <p className="text-sm text-gray-500">
                                Download all owned tabular reviews, cells, and
                                review chat records as JSON.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleExportTabularReviewsData}
                            disabled={isExportingTabularReviews}
                            className={`h-9 gap-1.5 text-sm ${accountGlassPrimaryButtonClassName}`}
                        >
                            {!isExportingTabularReviews && (
                                <Download className="h-4 w-4 shrink-0" />
                            )}
                            {isExportingTabularReviews
                                ? "Exporting..."
                                : "Export"}
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Export account JSON
                            </p>
                            <p className="text-sm text-gray-500">
                                Download account metadata, projects, document
                                metadata, workflows, and review data as JSON.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={handleExportAccountData}
                            disabled={isExportingAccount}
                            className={`h-9 gap-1.5 text-sm ${accountGlassPrimaryButtonClassName}`}
                        >
                            {!isExportingAccount && (
                                <Download className="h-4 w-4 shrink-0" />
                            )}
                            {isExportingAccount ? "Exporting..." : "Export"}
                        </Button>
                    </div>
                </AccountSection>
            </section>

            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Delete data
                </h2>
                <AccountSection>
                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Delete all chats
                            </p>
                            <p className="text-sm text-gray-500">
                                Permanently delete your assistant and tabular
                                review chat history.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => setPendingDeleteAction("chats")}
                            disabled={!!deletingAction}
                            className={`h-9 w-full shrink-0 gap-1.5 sm:w-auto ${accountGlassDangerOutlineButtonClassName}`}
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            Delete
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Delete all tabular reviews
                            </p>
                            <p className="text-sm text-gray-500">
                                Permanently delete all tabular reviews you own,
                                including cells and review chats.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() =>
                                setPendingDeleteAction("tabular-reviews")
                            }
                            disabled={!!deletingAction}
                            className={`h-9 w-full shrink-0 gap-1.5 sm:w-auto ${accountGlassDangerOutlineButtonClassName}`}
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            Delete
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Delete all projects
                            </p>
                            <p className="text-sm text-gray-500">
                                Permanently delete all projects you own,
                                including documents, chats, and tabular reviews.
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => setPendingDeleteAction("projects")}
                            disabled={!!deletingAction}
                            className={`h-9 w-full shrink-0 gap-1.5 sm:w-auto ${accountGlassDangerOutlineButtonClassName}`}
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            Delete
                        </Button>
                    </div>
                </AccountSection>
            </section>
            <ConfirmPopup
                open={!!pendingDeleteAction}
                title={pendingDeleteCopy?.title}
                message={pendingDeleteCopy?.message}
                confirmLabel="Delete"
                confirmStatus={deletingAction ? "loading" : "idle"}
                cancelLabel="Cancel"
                onCancel={() => {
                    if (deletingAction) return;
                    setPendingDeleteAction(null);
                }}
                onConfirm={() => {
                    if (!pendingDeleteAction) return;
                    void handleDeleteData(pendingDeleteAction);
                }}
            />
            <MfaVerificationPopup
                open={!!pendingMfaAction}
                onCancel={() => setPendingMfaAction(null)}
                onVerified={() => void handleMfaVerified()}
                title="Two-factor verification required"
                message="This action is sensitive. Enter a code from your authenticator app to continue."
            />
        </div>
    );
}
