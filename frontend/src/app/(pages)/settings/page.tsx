"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { PillButton } from "@/app/components/ui/pill-button";
import { FieldLabel } from "@/app/components/ui/form-field";
import { SettingsTextInput } from "@/app/components/settings/SettingsTextInput";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    MfaVerificationPopup,
    needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { WarningPopup } from "@/app/components/popups/WarningPopup";
import { deleteAccount, isMfaRequiredError } from "@/app/lib/mikeApi";
import { SettingsSection } from "./SettingsSection";

const isDev = process.env.NODE_ENV !== "production";
const devLog = (...args: Parameters<typeof console.log>) => {
    if (isDev) console.log(...args);
};

interface EmailWarning {
    title: string;
    message: string;
}

// The confirmation redirect param never changes under us — it is read once
// and then stripped from the URL — so the store has nothing to subscribe to.
const subscribeToNothing = () => () => {};
const readEmailChangeProcessed = () =>
    new URLSearchParams(window.location.search).get("emailChange") ===
    "processed";

export default function SettingsPage() {
    const router = useRouter();
    const { user, signOut, updateEmail } = useAuth();
    const { profile, updateDisplayName, updateOrganisation } = useUserProfile();
    const [displayName, setDisplayName] = useState(
        profile?.displayName ?? "",
    );
    const [isSavingName, setIsSavingName] = useState(false);
    const [saved, setSaved] = useState(false);
    const [organisation, setOrganisation] = useState(
        profile?.organisation ?? "",
    );
    const [isSavingOrg, setIsSavingOrg] = useState(false);
    const [orgSaved, setOrgSaved] = useState(false);
    const [email, setEmail] = useState(
        user?.email ? user.pendingEmail || user.email : "",
    );
    const [isSavingEmail, setIsSavingEmail] = useState(false);
    const [emailSaved, setEmailSaved] = useState(false);
    const [emailStatus, setEmailStatus] = useState<string | null>(null);
    const [emailWarning, setEmailWarning] = useState<EmailWarning | null>(null);
    const [emailMfaOpen, setEmailMfaOpen] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);
    const [accountDeleteMfaOpen, setAccountDeleteMfaOpen] = useState(false);

    // Re-seed the editable fields whenever the saved profile/user values
    // change, during render, via React's "adjusting state when props change"
    // pattern (the initial values above cover the first render).
    const [prevProfile, setPrevProfile] = useState(profile);
    if (prevProfile !== profile) {
        setPrevProfile(profile);
        if (profile?.displayName) {
            setDisplayName(profile.displayName);
        }
        if (profile?.organisation) {
            setOrganisation(profile.organisation);
        }
    }

    const [prevUserEmails, setPrevUserEmails] = useState({
        email: user?.email,
        pendingEmail: user?.pendingEmail,
    });
    if (
        prevUserEmails.email !== user?.email ||
        prevUserEmails.pendingEmail !== user?.pendingEmail
    ) {
        setPrevUserEmails({
            email: user?.email,
            pendingEmail: user?.pendingEmail,
        });
        if (user?.email) {
            setEmail(user.pendingEmail || user.email);
        }
    }

    // The `emailChange=processed` redirect is read through
    // useSyncExternalStore so it is a render-time value (with a `false`
    // server snapshot) rather than something an effect pushes into state.
    // The banner is then adjusted during render, and the effect below only
    // owns the URL cleanup — a genuine external-system update.
    const emailChangeProcessed = useSyncExternalStore(
        subscribeToNothing,
        readEmailChangeProcessed,
        () => false,
    );
    const [emailChangeApplied, setEmailChangeApplied] = useState(false);
    if (emailChangeProcessed && user && !emailChangeApplied) {
        setEmailChangeApplied(true);
        setEmailStatus(
            user.pendingEmail
                ? "One confirmation was accepted. Confirm the email change from both your current and new addresses to finish."
                : "Email updated.",
        );
    }

    useEffect(() => {
        if (!emailChangeApplied) return;
        window.history.replaceState({}, "", "/settings");
    }, [emailChangeApplied]);

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
            alert("Failed to delete account. Please try again.");
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
                    ? `Confirmation sent to your current address and ${pendingEmail}. Confirm both messages to finish the change. Your current email remains ${updatedUser.email} until then.`
                    : "Email updated.",
            );
            setTimeout(() => setEmailSaved(false), 2000);
        } catch (error: unknown) {
            devLog("[account/mfa] save email failed", { error });
            const message =
                error instanceof Error
                    ? error.message
                    : "Failed to update email. Please try again.";

            if (isAlreadyRegisteredEmailError(message)) {
                setEmail(user?.pendingEmail || user?.email || "");
                setEmailWarning({
                    title: "Email already registered",
                    message,
                });
                return;
            }

            if (isEmailRateLimitError(message)) {
                setEmail(user?.pendingEmail || user?.email || "");
                setEmailWarning({
                    title: "Email change unavailable",
                    message:
                        "You can’t change your email this often. Please wait before trying again.",
                });
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
            alert("Failed to update display name. Please try again.");
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
            alert("Failed to update organisation. Please try again.");
        }
    };

    if (!user) return null;

    return (
        <div className="space-y-8">
            {/* Profile Settings */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Profile
                </h2>
                <SettingsSection>
                    <div className="space-y-8 p-4">
                        <div>
                            <FieldLabel className="text-sm text-gray-600">
                                Display Name
                            </FieldLabel>
                            <div className="space-y-2">
                                <SettingsTextInput
                                    type="text"
                                    value={displayName}
                                    onChange={(e) =>
                                        setDisplayName(e.target.value)
                                    }
                                    placeholder="Enter your name"
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
                                        {isSavingName
                                            ? "Saving..."
                                            : saved
                                              ? "Saved"
                                              : "Save"}
                                    </button>
                                </div>
                            </div>
                        </div>
                        <div>
                            <FieldLabel className="text-sm text-gray-600">
                                Organisation
                            </FieldLabel>
                            <div className="space-y-2">
                                <SettingsTextInput
                                    type="text"
                                    value={organisation}
                                    onChange={(e) =>
                                        setOrganisation(e.target.value)
                                    }
                                    placeholder="Enter your organisation"
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
                                        {isSavingOrg
                                            ? "Saving..."
                                            : orgSaved
                                              ? "Saved"
                                              : "Save"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </SettingsSection>
            </section>

            {/* Email */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Email
                </h2>
                <SettingsSection>
                    <div className="space-y-2 p-4">
                        <SettingsTextInput
                            type="email"
                            value={email}
                            onChange={(event) => {
                                setEmail(event.target.value);
                                setEmailStatus(null);
                                setEmailWarning(null);
                                setEmailSaved(false);
                            }}
                            placeholder="Enter your email"
                        />
                        {emailStatus ? (
                            <p className="text-xs text-gray-500">
                                {emailStatus}
                            </p>
                        ) : user.pendingEmail ? (
                            <p className="text-xs text-gray-500">
                                Pending confirmation: {user.pendingEmail}
                            </p>
                        ) : null}
                        {emailStatus && (
                            <p className="text-xs text-gray-400">
                                Current email: {user.email}
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
                                {isSavingEmail
                                    ? "Saving..."
                                    : emailSaved
                                      ? "Saved"
                                      : "Save"}
                            </button>
                        </div>
                    </div>
                </SettingsSection>
            </section>

            {/* Plan */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Usage Plan
                </h2>
                <SettingsSection>
                    <div className="p-4">
                        <p className="text-base font-medium text-gray-500 capitalize">
                            {profile?.tier || "Free"}
                        </p>
                    </div>
                </SettingsSection>
            </section>

            {/* Danger Zone */}
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-red-600">
                    Danger Zone
                </h2>
                <SettingsSection>
                    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-700">
                                Delete account
                            </p>
                            <p className="text-sm text-gray-500">
                                Permanently delete your account and all
                                associated data. This action cannot be undone.
                            </p>
                        </div>
                        <PillButton
                            tone="danger"
                            size="sm"
                            onClick={() => setDeleteConfirm(true)}
                            disabled={isDeleting}
                            className="w-full shrink-0 sm:w-auto"
                        >
                            <Trash2 className="h-4 w-4 shrink-0" />
                            Delete account
                        </PillButton>
                    </div>
                </SettingsSection>
            </section>
            <ConfirmPopup
                open={deleteConfirm}
                title="Delete account?"
                message="This will permanently delete your account and all associated data. This action cannot be undone."
                confirmLabel="Delete"
                confirmStatus={isDeleting ? "loading" : "idle"}
                cancelLabel="Cancel"
                onCancel={() => {
                    if (isDeleting) return;
                    setDeleteConfirm(false);
                }}
                onConfirm={() => void handleDeleteAccount()}
            />
            <WarningPopup
                open={!!emailWarning}
                title={emailWarning?.title}
                message={emailWarning?.message}
                onClose={() => setEmailWarning(null)}
            />
            <MfaVerificationPopup
                open={accountDeleteMfaOpen}
                onCancel={() => setAccountDeleteMfaOpen(false)}
                onVerified={() => {
                    devLog(
                        "[account/mfa] account delete verification callback",
                    );
                    setAccountDeleteMfaOpen(false);
                    void handleDeleteAccount();
                }}
                title="Two-factor verification required"
                message="Account deletion is sensitive. Enter a code from your authenticator app to continue."
            />
            <MfaVerificationPopup
                open={emailMfaOpen}
                onCancel={() => setEmailMfaOpen(false)}
                onVerified={() => {
                    devLog("[account/mfa] email verification callback");
                    setEmailMfaOpen(false);
                    void handleSaveEmail();
                }}
                title="Two-factor verification required"
                message="Email changes are sensitive. Enter a code from your authenticator app to continue."
            />
        </div>
    );
}

function isAlreadyRegisteredEmailError(message: string) {
    return message
        .toLowerCase()
        .includes("a user with this email address has already been registered");
}

function isEmailRateLimitError(message: string) {
    return /email.*rate limit|rate limit.*email/i.test(message);
}
