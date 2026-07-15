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
        title: "删除全部对话？",
        message:
            "将永久删除您的助理与表格审查对话历史。此操作无法撤销。",
    },
    "tabular-reviews": {
        title: "删除全部表格审查？",
        message:
            "将永久删除您拥有的全部表格审查，包括其单元格与审查对话。此操作无法撤销。",
    },
    projects: {
        title: "删除全部项目？",
        message:
            "将永久删除您拥有的全部项目，包括其文档、对话与表格审查。此操作无法撤销。",
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
            alert("导出账户数据失败，请重试。");
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
            alert("导出对话失败，请重试。");
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
            alert("导出表格审查失败，请重试。");
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
            alert("删除数据失败，请重试。");
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
                    导出数据
                </h2>
                <AccountSection>
                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                导出对话
                            </p>
                            <p className="text-sm text-gray-500">
                                将助理与表格审查的对话历史下载为 JSON。
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
                            {isExportingChats ? "导出中..." : "导出"}
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                导出表格审查
                            </p>
                            <p className="text-sm text-gray-500">
                                将您拥有的全部表格审查、单元格与审查对话记录下载为 JSON。
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
                                ? "导出中..."
                                : "导出"}
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                导出账户 JSON
                            </p>
                            <p className="text-sm text-gray-500">
                                将账户元数据、项目、文档元数据、工作流与审查数据下载为 JSON。
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
                            {isExportingAccount ? "导出中..." : "导出"}
                        </Button>
                    </div>
                </AccountSection>
            </section>

            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    删除数据
                </h2>
                <AccountSection>
                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                删除全部对话
                            </p>
                            <p className="text-sm text-gray-500">
                                永久删除您的助理与表格审查对话历史。
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => setPendingDeleteAction("chats")}
                            disabled={!!deletingAction}
                            className={`h-9 w-full shrink-0 gap-1.5 sm:w-auto ${accountGlassDangerOutlineButtonClassName}`}
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            删除
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                删除全部表格审查
                            </p>
                            <p className="text-sm text-gray-500">
                                永久删除您拥有的全部表格审查，包括单元格与审查对话。
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
                            删除
                        </Button>
                    </div>
                    <div className="mx-4 h-px bg-gray-200" />

                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                删除全部项目
                            </p>
                            <p className="text-sm text-gray-500">
                                永久删除您拥有的全部项目，包括文档、对话与表格审查。
                            </p>
                        </div>
                        <Button
                            variant="outline"
                            onClick={() => setPendingDeleteAction("projects")}
                            disabled={!!deletingAction}
                            className={`h-9 w-full shrink-0 gap-1.5 sm:w-auto ${accountGlassDangerOutlineButtonClassName}`}
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            删除
                        </Button>
                    </div>
                </AccountSection>
            </section>
            <ConfirmPopup
                open={!!pendingDeleteAction}
                title={pendingDeleteCopy?.title}
                message={pendingDeleteCopy?.message}
                confirmLabel="删除"
                confirmStatus={deletingAction ? "loading" : "idle"}
                cancelLabel="取消"
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
                title="需要双重验证"
                message="此操作属于敏感操作。请输入身份验证器应用中的验证码以继续。"
            />
        </div>
    );
}
