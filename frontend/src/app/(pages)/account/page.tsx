"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Trash2 } from "lucide-react";
import { Button } from "@/app/components/ui/button";
import { Input } from "@/app/components/ui/input";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    MfaVerificationPopup,
    needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { deleteAccount, isMfaRequiredError } from "@/app/lib/mikeApi";
import {
    accountGlassDangerOutlineButtonClassName,
    accountGlassInputClassName,
    accountGlassPrimaryButtonClassName,
} from "./accountStyles";
import { AccountSection } from "./AccountSection";

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

export default function AccountPage() {
    const router = useRouter();
    const { user, signOut, updateEmail } = useAuth();
    const { profile, updateDisplayName, updateOrganisation } = useUserProfile();
    const [displayName, setDisplayName] = useState("");
    const [isSavingName, setIsSavingName] = useState(false);
    const [saved, setSaved] = useState(false);
    const [organisation, setOrganisation] = useState("");
    const [isSavingOrg, setIsSavingOrg] = useState(false);
    const [orgSaved, setOrgSaved] = useState(false);
    const [email, setEmail] = useState("");
    const [isSavingEmail, setIsSavingEmail] = useState(false);
    const [emailSaved, setEmailSaved] = useState(false);
    const [emailStatus, setEmailStatus] = useState<string | null>(null);
    const [emailWarning, setEmailWarning] = useState<string | null>(null);
    const [emailMfaOpen, setEmailMfaOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [accountDeleteMfaOpen, setAccountDeleteMfaOpen] = useState(false);

    useEffect(() => {
        if (profile?.displayName) {
            setDisplayName(profile.displayName);
        }
        if (profile?.organisation) {
            setOrganisation(profile.organisation);
        }
    }, [profile]);

    useEffect(() => {
        if (user?.email) {
            setEmail(user.pendingEmail || user.email);
        }
    }, [user?.email, user?.pendingEmail]);

    const handleLogout = async () => {
        await signOut();
        router.push("/");
    };

    const handleDeleteAccount = async () => {
        devLog("[account/mfa] delete account requested");
        setIsDeleting(true);
        try {
            if (await needsMfaVerification()) {
                setDeleteConfirm(false);
                setAccountDeleteMfaOpen(true);
                setIsDeleting(false);
                return;
            }
            await deleteAccount();
            await signOut();
            router.push("/");
        } catch (error) {
            setIsDeleting(false);
            devLog("[account/mfa] delete account failed", {
                isMfaRequired: isMfaRequiredError(error),
                error,
            });
            if (isMfaRequiredError(error)) {
                setDeleteConfirm(false);
                setAccountDeleteMfaOpen(true);
                return;
            }
            setDeleteConfirm(false);
            alert("删除账户失败，请重试。");
        }
    };

    const handleSaveEmail = async () => {
        const nextEmail = email.trim();
        if (!nextEmail || nextEmail === user?.email) return;

        devLog("[account/mfa] save email requested");
        setIsSavingEmail(true);
        setEmailStatus(null);
        setEmailWarning(null);
        try {
            if (await needsMfaVerification()) {
                setEmailMfaOpen(true);
                return;
            }

            const updatedUser = await updateEmail(nextEmail);
            const pendingEmail = updatedUser.pendingEmail;
            setEmail(pendingEmail || updatedUser.email);
            setEmailSaved(true);
            setEmailStatus(
                pendingEmail
                    ? `Confirmation sent to ${pendingEmail}. Your current email remains ${updatedUser.email} until the change is confirmed.`
                    : "邮箱已更新。",
            );
            setTimeout(() => setEmailSaved(false), 2000);
        } catch (error: unknown) {
            devLog("[account/mfa] save email failed", { error });
            const message =
                error instanceof Error
                    ? error.message
                    : "更新邮箱失败，请重试。";

            if (isAlreadyRegisteredEmailError(message)) {
                setEmail(user?.pendingEmail || user?.email || "");
                setEmailWarning(message);
                return;
            }

            setEmailStatus(message);
        } finally {
            setIsSavingEmail(false);
        }
    };

    const handleSaveDisplayName = async () => {
        setIsSavingName(true);
        const success = await updateDisplayName(displayName.trim());
        setIsSavingName(false);

        if (success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            alert("更新显示名称失败，请重试。");
        }
    };

    const handleSaveOrganisation = async () => {
        setIsSavingOrg(true);
        const success = await updateOrganisation(organisation.trim());
        setIsSavingOrg(false);

        if (success) {
            setOrgSaved(true);
            setTimeout(() => setOrgSaved(false), 2000);
        } else {
            alert("更新所属机构失败，请重试。");
        }
    };

    if (!user) return null;

    return (
        <div className="space-y-8">
            {/* Profile Settings */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    个人资料
                </h2>
                <AccountSection className="p-4">
                    <div className="divide-y divide-gray-200">
                        <div className="pb-4">
                            <label className="text-sm text-gray-600 block mb-2">
                                显示名称
                            </label>
                            <div className="space-y-2">
                                <Input
                                    type="text"
                                    value={displayName}
                                    onChange={(e) =>
                                        setDisplayName(e.target.value)
                                    }
                                    placeholder="请输入姓名"
                                    className={accountGlassInputClassName}
                                />
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleSaveDisplayName}
                                        disabled={
                                            isSavingName ||
                                            !displayName.trim() ||
                                            saved
                                        }
                                        className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                                    >
                                        {isSavingName ? (
                                            "保存中..."
                                        ) : saved ? (
                                            "已保存"
                                        ) : (
                                            "保存"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div className="pt-4">
                            <label className="text-sm text-gray-600 block mb-2">
                                所属机构
                            </label>
                            <div className="space-y-2">
                                <Input
                                    type="text"
                                    value={organisation}
                                    onChange={(e) =>
                                        setOrganisation(e.target.value)
                                    }
                                    placeholder="请输入所属机构"
                                    className={accountGlassInputClassName}
                                />
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleSaveOrganisation}
                                        disabled={
                                            isSavingOrg ||
                                            organisation.trim() ===
                                                (profile?.organisation ?? "") ||
                                            orgSaved
                                        }
                                        className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                                    >
                                        {isSavingOrg ? (
                                            "保存中..."
                                        ) : orgSaved ? (
                                            "已保存"
                                        ) : (
                                            "保存"
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </AccountSection>
            </section>

            {/* Email */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    邮箱
                </h2>
                <AccountSection className="p-4">
                    <div className="space-y-2">
                        <Input
                            type="email"
                            value={email}
                            onChange={(event) => {
                                setEmail(event.target.value);
                                setEmailStatus(null);
                                setEmailWarning(null);
                                setEmailSaved(false);
                            }}
                            placeholder="请输入邮箱"
                            className={accountGlassInputClassName}
                        />
                        {emailStatus ? (
                            <p className="text-xs text-gray-500">
                                {emailStatus}
                            </p>
                        ) : user.pendingEmail ? (
                            <p className="text-xs text-gray-500">
                                待确认：{user.pendingEmail}
                            </p>
                        ) : null}
                        {emailStatus && (
                            <p className="text-xs text-gray-400">
                                当前邮箱：{user.email}
                            </p>
                        )}
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveEmail}
                                disabled={
                                    isSavingEmail ||
                                    !email.trim() ||
                                    email.trim() === user.email ||
                                    email.trim() === user.pendingEmail ||
                                    emailSaved
                                }
                                className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                            >
                                {isSavingEmail ? (
                                    "保存中..."
                                ) : emailSaved ? (
                                    "已保存"
                                ) : (
                                    "保存"
                                )}
                            </button>
                        </div>
                    </div>
                </AccountSection>
            </section>

            {/* Plan */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    使用方案
                </h2>
                <AccountSection className="p-4">
                    <div>
                        <p className="text-base font-medium text-gray-500 capitalize">
                            {profile?.tier || "免费版"}
                        </p>
                    </div>
                </AccountSection>
            </section>

            {/* Actions */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    操作
                </h2>
                <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="w-full gap-1.5 rounded-lg border border-transparent bg-gray-950 px-3 text-white shadow-none transition-colors hover:bg-gray-900 hover:text-white active:bg-black sm:w-auto"
                >
                    <LogOut className="h-4 w-4 shrink-0" />
                    退出登录
                </Button>
            </section>

            {/* Danger Zone */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-red-600">
                    危险操作
                </h2>
                <AccountSection className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="space-y-1">
                        <p className="text-sm font-medium text-gray-900">
                            删除账户
                        </p>
                        <p className="text-sm text-gray-500">
                            永久删除您的账户及所有相关数据。此操作无法撤销。
                        </p>
                    </div>
                    <Button
                        variant="outline"
                        onClick={() => setDeleteConfirm(true)}
                        disabled={isDeleting}
                        className={`w-full shrink-0 gap-1.5 sm:w-auto ${accountGlassDangerOutlineButtonClassName}`}
                    >
                        <Trash2 className="h-4 w-4 shrink-0" />
                        删除账户
                    </Button>
                </AccountSection>
            </section>
            <ConfirmPopup
                open={deleteConfirm}
                title="删除账户？"
                message="将永久删除您的账户及所有相关数据。此操作无法撤销。"
                confirmLabel="删除"
                confirmStatus={isDeleting ? "loading" : "idle"}
                cancelLabel="取消"
                onCancel={() => {
                    if (isDeleting) return;
                    setDeleteConfirm(false);
                }}
                onConfirm={() => void handleDeleteAccount()}
            />
            <WarningPopup
                open={!!emailWarning}
                title="该邮箱已被注册"
                message={emailWarning}
                onClose={() => setEmailWarning(null)}
            />
            <MfaVerificationPopup
                open={accountDeleteMfaOpen}
                onCancel={() => setAccountDeleteMfaOpen(false)}
                onVerified={() => {
                    devLog("[account/mfa] account delete verification callback");
                    setAccountDeleteMfaOpen(false);
                    void handleDeleteAccount();
                }}
                title="需要双重验证"
                message="删除账户属于敏感操作。请输入身份验证器应用中的验证码以继续。"
            />
            <MfaVerificationPopup
                open={emailMfaOpen}
                onCancel={() => setEmailMfaOpen(false)}
                onVerified={() => {
                    devLog("[account/mfa] email verification callback");
                    setEmailMfaOpen(false);
                    void handleSaveEmail();
                }}
                title="需要双重验证"
                message="修改邮箱属于敏感操作。请输入身份验证器应用中的验证码以继续。"
            />
        </div>
    );
}

function isAlreadyRegisteredEmailError(message: string) {
    return message
        .toLowerCase()
        .includes("a user with this email address has already been registered");
}
