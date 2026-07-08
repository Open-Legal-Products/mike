"use client";

import {
    useEffect,
    useRef,
    useState,
    type ClipboardEvent,
    type KeyboardEvent,
} from "react";
import { Copy, Loader2 } from "lucide-react";
import { supabase } from "@/app/lib/supabase";
import { Button } from "@/app/components/ui/button";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { isMfaRequiredError } from "@/app/lib/mikeApi";
import { Modal } from "@/app/components/modals/Modal";
import {
    MfaVerificationPopup,
    needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import {
    accountGlassPrimaryButtonClassName,
} from "../accountStyles";
import { AccountSection } from "../AccountSection";
import { AccountToggle } from "../AccountToggle";

type MfaFactor = {
    id: string;
    friendly_name?: string | null;
    factor_type: string;
    status?: string;
};

type Enrollment = {
    factorId: string;
    challengeId: string;
    qrCode: string;
    secret: string;
};

const isDev = process.env.NODE_ENV !== "production";
const traceMfa = (...args: Parameters<typeof console.info>) => {
    if (isDev) console.info(...args);
};

function summarizeFactors(factors: MfaFactor[]) {
    return factors.map((factor) => ({
        type: factor.factor_type,
        status: factor.status ?? "unknown",
        friendlyName: factor.friendly_name ?? null,
    }));
}

function isDuplicateFriendlyNameError(error: unknown) {
    const message =
        error instanceof Error
            ? error.message
            : typeof error === "object" &&
                error !== null &&
                "message" in error &&
                typeof error.message === "string"
              ? error.message
              : "";
    return message
        .toLowerCase()
        .includes("a factor with the friendly name");
}

function VerificationCodeInput({
    value,
    onChange,
    disabled,
}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
}) {
    const inputsRef = useRef<Array<HTMLInputElement | null>>([]);
    const digits = Array.from({ length: 6 }, (_, index) => value[index] ?? "");

    function updateDigit(index: number, nextValue: string) {
        const digit = nextValue.replace(/\D/g, "").slice(-1);
        const nextDigits = [...digits];
        nextDigits[index] = digit;
        onChange(nextDigits.join(""));
        if (digit && index < inputsRef.current.length - 1) {
            inputsRef.current[index + 1]?.focus();
        }
    }

    function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
        event.preventDefault();
        const pasted = event.clipboardData
            .getData("text")
            .replace(/\D/g, "")
            .slice(0, 6);
        if (!pasted) return;
        onChange(pasted);
        inputsRef.current[Math.min(pasted.length, 6) - 1]?.focus();
    }

    function handleKeyDown(
        event: KeyboardEvent<HTMLInputElement>,
        index: number,
    ) {
        if (event.key === "Backspace" && !digits[index] && index > 0) {
            inputsRef.current[index - 1]?.focus();
        }
        if (event.key === "ArrowLeft" && index > 0) {
            event.preventDefault();
            inputsRef.current[index - 1]?.focus();
        }
        if (event.key === "ArrowRight" && index < digits.length - 1) {
            event.preventDefault();
            inputsRef.current[index + 1]?.focus();
        }
    }

    return (
        <div
            className="flex justify-center gap-2"
            role="group"
            aria-label="Six digit verification code"
        >
            {digits.map((digit, index) => (
                <input
                    key={index}
                    ref={(element) => {
                        inputsRef.current[index] = element;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete={index === 0 ? "one-time-code" : "off"}
                    value={digit}
                    disabled={disabled}
                    onChange={(event) =>
                        updateDigit(index, event.target.value)
                    }
                    onPaste={handlePaste}
                    onKeyDown={(event) => handleKeyDown(event, index)}
                    className="h-11 w-10 rounded-lg border border-transparent bg-gray-100 text-center text-lg font-medium text-gray-950 shadow-none outline-none transition-colors focus:border-gray-200 focus:ring-2 focus:ring-gray-300/45 disabled:cursor-not-allowed disabled:opacity-45"
                    aria-label={`Verification code digit ${index + 1}`}
                    maxLength={1}
                />
            ))}
        </div>
    );
}

function MfaSettingsSkeleton() {
    return (
        <div className="px-4 py-5">
            <div className="space-y-1">
                <div className="flex items-start justify-between gap-3">
                    <div className="h-4 w-36 animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-14 shrink-0 animate-pulse rounded bg-gray-100" />
                </div>
                <div className="space-y-1.5 pt-1">
                    <div className="h-3 w-full max-w-md animate-pulse rounded bg-gray-100" />
                    <div className="h-3 w-3/4 max-w-sm animate-pulse rounded bg-gray-100" />
                </div>
            </div>
            <div className="mt-3 flex justify-end">
                <div className="h-9 w-20 animate-pulse rounded-lg bg-gray-100" />
            </div>
        </div>
    );
}

export default function SecurityPage() {
    const { profile, updateMfaOnLogin } = useUserProfile();
    const [loading, setLoading] = useState(true);
    const [factors, setFactors] = useState<MfaFactor[]>([]);
    const [currentLevel, setCurrentLevel] = useState<string | null>(null);
    const [nextLevel, setNextLevel] = useState<string | null>(null);
    const [setupModalOpen, setSetupModalOpen] = useState(false);
    const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
    const [verificationCode, setVerificationCode] = useState("");
    const [setupKeyCopied, setSetupKeyCopied] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [savingLoginPreference, setSavingLoginPreference] = useState(false);
    const [pendingUnenrollFactorId, setPendingUnenrollFactorId] = useState<
        string | null
    >(null);
    const [pendingLoginPreference, setPendingLoginPreference] = useState<
        boolean | null
    >(null);

    async function refreshMfaState() {
        setLoading(true);
        setStatus(null);
        traceMfa("[security/mfa] refreshing state");
        const [factorResult, aalResult] = await Promise.all([
            supabase.auth.mfa.listFactors(),
            supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
        ]);

        if (factorResult.error) {
            traceMfa("[security/mfa] list factors failed", {
                error: factorResult.error.message,
            });
            setStatus(factorResult.error.message);
            setFactors([]);
        } else {
            const verifiedTotp = (factorResult.data.totp ?? []) as MfaFactor[];
            const allFactors = (factorResult.data.all ?? []) as MfaFactor[];
            traceMfa("[security/mfa] factors loaded", {
                allCount: allFactors.length,
                verifiedTotpCount: verifiedTotp.length,
                all: summarizeFactors(allFactors),
            });
            setFactors(verifiedTotp);
        }

        if (aalResult.error) {
            traceMfa("[security/mfa] assurance lookup failed", {
                error: aalResult.error.message,
            });
            setStatus(aalResult.error.message);
            setCurrentLevel(null);
            setNextLevel(null);
        } else {
            traceMfa("[security/mfa] assurance level", {
                currentLevel: aalResult.data.currentLevel,
                nextLevel: aalResult.data.nextLevel,
            });
            setCurrentLevel(aalResult.data.currentLevel);
            setNextLevel(aalResult.data.nextLevel);
        }
        setLoading(false);
    }

    useEffect(() => {
        traceMfa("[security/mfa] page mounted");
        void refreshMfaState();
    }, []);

    useEffect(() => {
        traceMfa("[security/mfa] rendered state", {
            loading,
            verifiedFactorCount: factors.length,
            currentLevel,
            nextLevel,
            hasEnrollment: !!enrollment,
        });
    }, [currentLevel, enrollment, factors.length, loading, nextLevel]);

    async function startEnrollment() {
        setBusy(true);
        setStatus(null);
        try {
            traceMfa("[security/mfa] enrollment requested");

            let { data, error } = await supabase.auth.mfa.enroll({
                factorType: "totp",
                friendlyName: "Mike",
            });
            if (error && isDuplicateFriendlyNameError(error)) {
                traceMfa("[security/mfa] retrying enrollment with unique name", {
                    error: error.message,
                });
                const retry = await supabase.auth.mfa.enroll({
                    factorType: "totp",
                    friendlyName: `Mike ${Date.now()}`,
                });
                data = retry.data;
                error = retry.error;
            }
            if (error) throw error;
            if (!data) throw new Error("Failed to start MFA setup.");
            traceMfa("[security/mfa] enrollment created", {
                factorId: data.id,
            });

            const challenge = await supabase.auth.mfa.challenge({
                factorId: data.id,
            });
            if (challenge.error) throw challenge.error;
            traceMfa("[security/mfa] enrollment challenge created", {
                factorId: data.id,
                challengeId: challenge.data.id,
            });

            setEnrollment({
                factorId: data.id,
                challengeId: challenge.data.id,
                qrCode: data.totp.qr_code,
                secret: data.totp.secret,
            });
            setVerificationCode("");
            setSetupKeyCopied(false);
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? error.message
                    : "Failed to start MFA setup.",
            );
        } finally {
            setBusy(false);
        }
    }

    async function closeSetupModal() {
        if (busy) return;
        setSetupModalOpen(false);
        if (enrollment) {
            await cancelEnrollment();
        } else {
            setVerificationCode("");
            setSetupKeyCopied(false);
        }
    }

    async function returnToSetupInstructions() {
        if (busy || !enrollment) return;
        await cancelEnrollment();
    }

    async function verifyEnrollment() {
        if (!enrollment || verificationCode.trim().length !== 6) return;

        setBusy(true);
        setStatus(null);
        try {
            traceMfa("[security/mfa] verifying enrollment", {
                factorId: enrollment.factorId,
                challengeId: enrollment.challengeId,
            });
            const { error } = await supabase.auth.mfa.verify({
                factorId: enrollment.factorId,
                challengeId: enrollment.challengeId,
                code: verificationCode.trim(),
            });
            if (error) throw error;
            traceMfa("[security/mfa] enrollment verified", {
                factorId: enrollment.factorId,
            });

            setEnrollment(null);
            setSetupModalOpen(false);
            setVerificationCode("");
            setSetupKeyCopied(false);
            setStatus("MFA enabled.");
            await refreshMfaState();
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? error.message
                    : "Failed to verify MFA code.",
            );
        } finally {
            setBusy(false);
        }
    }

    async function cancelEnrollment() {
        const factorId = enrollment?.factorId;
        setEnrollment(null);
        setVerificationCode("");
        setSetupKeyCopied(false);
        if (factorId) {
            await supabase.auth.mfa.unenroll({ factorId }).catch(() => null);
        }
        await refreshMfaState();
    }

    async function copySetupKey() {
        if (!enrollment?.secret) return;
        await navigator.clipboard.writeText(enrollment.secret);
        setSetupKeyCopied(true);
        window.setTimeout(() => setSetupKeyCopied(false), 1600);
    }

    async function requestUnenroll(factorId: string) {
        setStatus(null);
        const { data, error } =
            await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
        if (error) {
            setStatus(error.message);
            return;
        }

        if (data.nextLevel === "aal2" && data.currentLevel !== "aal2") {
            setPendingUnenrollFactorId(factorId);
            return;
        }

        await unenrollFactor(factorId);
    }

    async function unenrollFactor(factorId: string) {
        setBusy(true);
        setStatus(null);
        const { error } = await supabase.auth.mfa.unenroll({ factorId });
        setBusy(false);

        if (error) {
            if (
                error.message.toLowerCase().includes("aal") ||
                error.code === "insufficient_aal"
            ) {
                setPendingUnenrollFactorId(factorId);
                return;
            }
            setStatus(error.message);
            return;
        }

        setStatus("MFA disabled.");
        if (profile?.mfaOnLogin) {
            void updateMfaOnLogin(false);
        }
        await refreshMfaState();
    }

    async function handleLoginPreferenceToggle() {
        if (!hasVerifiedFactor || savingLoginPreference) return;
        const enabled = !(profile?.mfaOnLogin === true);
        setSavingLoginPreference(true);
        setStatus(null);
        try {
            if (await needsMfaVerification()) {
                setPendingLoginPreference(enabled);
                return;
            }
            await saveLoginPreference(enabled);
        } catch (error) {
            setStatus(
                error instanceof Error
                    ? error.message
                    : "Failed to update login authentication preference.",
            );
        } finally {
            setSavingLoginPreference(false);
        }
    }

    async function saveLoginPreference(enabled: boolean) {
        setSavingLoginPreference(true);
        setStatus(null);
        try {
            const success = await updateMfaOnLogin(enabled);
            if (!success) {
                setStatus("Failed to update login authentication preference.");
            }
        } catch (error) {
            if (isMfaRequiredError(error)) {
                setPendingLoginPreference(enabled);
            } else {
                setStatus(
                    error instanceof Error
                        ? error.message
                        : "Failed to update login authentication preference.",
                );
            }
        } finally {
            setSavingLoginPreference(false);
        }
    }

    const hasVerifiedFactor = factors.length > 0;
    const sessionVerified = currentLevel === "aal2";
    const loginMfaEnabled = profile?.mfaOnLogin === true;

    return (
        <div className="space-y-8">
            <section className="space-y-3">
                <h2 className="text-2xl font-medium font-serif text-gray-900">
                    Multi-Factor Authentication
                </h2>
                <AccountSection>
                    {loading ? (
                        <MfaSettingsSkeleton />
                    ) : (
                        <>
                            <div className="px-4 py-5">
                                <div className="space-y-1">
                                    <div className="flex items-start justify-between gap-3">
                                        <p className="text-sm font-medium text-gray-900">
                                            Verification method
                                        </p>
                                        <span
                                            className={`shrink-0 text-xs font-medium ${
                                                hasVerifiedFactor
                                                    ? "text-green-700"
                                                    : "text-gray-500"
                                            }`}
                                        >
                                            {hasVerifiedFactor
                                                ? "Enabled"
                                                : "Not set up"}
                                        </span>
                                    </div>
                                    <p className="text-sm text-gray-500">
                                        {hasVerifiedFactor
                                            ? sessionVerified
                                                ? "Authenticator app is saved on your account. Sensitive actions are unlocked for this session."
                                                : "Authenticator app is saved on your account. Sensitive actions require a verification code."
                                            : "Add an authenticator app to protect sensitive actions such as exporting data, deleting data, deleting your account, and changing API keys."}
                                    </p>
                                </div>
                                {!hasVerifiedFactor && !enrollment ? (
                                    <div className="mt-3 flex justify-end">
                                        <Button
                                            variant="outline"
                                            onClick={() =>
                                                setSetupModalOpen(true)
                                            }
                                            disabled={busy}
                                            className={`h-9 w-full gap-1.5 sm:w-auto ${accountGlassPrimaryButtonClassName}`}
                                        >
                                            {busy ? (
                                                <>
                                                    <Loader2 className="h-4 w-4 animate-spin" />
                                                    Starting...
                                                </>
                                            ) : (
                                                "Set up"
                                            )}
                                        </Button>
                                    </div>
                                ) : null}
                            </div>

                            {hasVerifiedFactor && (
                                <>
                                    <div className="mx-4 h-px bg-gray-200" />
                                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                                        <div className="space-y-1">
                                            <p className="text-sm font-medium text-gray-900">
                                                Login verification
                                            </p>
                                            <p className="text-sm text-gray-500">
                                                Ask for an authenticator code
                                                after each new login, instead of
                                                only before sensitive actions.
                                            </p>
                                        </div>
                                        <AccountToggle
                                            checked={loginMfaEnabled}
                                            disabled={savingLoginPreference}
                                            loading={savingLoginPreference}
                                            size="md"
                                            onChange={() =>
                                                void handleLoginPreferenceToggle()
                                            }
                                        />
                                    </div>
                                    <div className="flex justify-end px-4 pb-4 pt-1">
                                        <button
                                            type="button"
                                            onClick={() =>
                                                void requestUnenroll(
                                                    factors[0]?.id,
                                                )
                                            }
                                            disabled={busy || !factors[0]?.id}
                                            className="text-xs font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:text-red-300"
                                        >
                                            Remove authenticator app
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    )}

                    {status && (
                        <>
                            <div className="mx-4 h-px bg-gray-200" />
                            <p className="px-4 py-3 text-xs text-gray-500">
                                {status}
                            </p>
                        </>
                    )}
                </AccountSection>
            </section>
            <Modal
                open={setupModalOpen}
                onClose={() => void closeSetupModal()}
                breadcrumbs={["Security", "Set up authenticator app"]}
                cancelAction={{
                    label: enrollment ? "Back" : "Cancel",
                    onClick: enrollment
                        ? () => void returnToSetupInstructions()
                        : () => void closeSetupModal(),
                    disabled: busy,
                }}
                primaryAction={
                    enrollment
                        ? {
                              label: busy ? "Verifying..." : "Verify",
                              onClick: () => void verifyEnrollment(),
                              disabled:
                                  busy || verificationCode.trim().length !== 6,
                          }
                        : {
                              label: busy ? "Starting..." : "Continue",
                              onClick: () => void startEnrollment(),
                              disabled: busy,
                          }
                }
            >
                <div
                    className={
                        enrollment
                            ? "min-h-0 flex-1 space-y-3 overflow-y-auto pt-2"
                            : "min-h-0 flex-1 space-y-5 overflow-y-auto pt-3"
                    }
                >
                    {!enrollment ? (
                        <>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                Step 1
                            </p>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-gray-900">
                                    Before you start
                                </p>
                                <p className="text-sm text-gray-500">
                                    Download an authenticator app such as Google
                                    Authenticator, Microsoft Authenticator,
                                    Authy, 1Password, or iCloud Passwords.
                                </p>
                            </div>
                            <ol className="list-decimal space-y-1 pl-4 text-sm text-gray-500">
                                <li>
                                    Download and open your authenticator app.
                                </li>
                                <li>
                                    Choose the option to add a new account.
                                </li>
                            </ol>
                        </>
                    ) : (
                        <>
                            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
                                Step 2
                            </p>
                            <div className="space-y-1">
                                <p className="text-sm font-medium text-gray-900">
                                    Scan this code
                                </p>
                                <p className="text-sm text-gray-500">
                                    In your authenticator app, add a new account
                                    and scan the QR code. If you cannot scan it,
                                    enter the setup key below manually.
                                </p>
                            </div>
                            <div className="min-w-0">
                                <div className="mb-1 flex items-center justify-between gap-3">
                                    <p className="text-xs font-medium text-gray-500">
                                        Setup key
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => void copySetupKey()}
                                        className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 transition-colors hover:text-gray-950"
                                    >
                                        <Copy className="h-3 w-3" />
                                        {setupKeyCopied ? "Copied" : "Copy"}
                                    </button>
                                </div>
                                <p className="break-all text-xs text-gray-700">
                                    {enrollment.secret}
                                </p>
                            </div>
                            <div className="flex justify-center">
                                <div className="flex h-48 w-48 items-center justify-center rounded-xl bg-white p-2">
                                    <img
                                        src={enrollment.qrCode}
                                        alt="MFA QR code"
                                        className="h-full w-full"
                                    />
                                </div>
                            </div>
                            <div className="min-w-0 space-y-3">
                                <VerificationCodeInput
                                    value={verificationCode}
                                    onChange={setVerificationCode}
                                    disabled={busy}
                                />
                            </div>
                        </>
                    )}
                </div>
            </Modal>
            <MfaVerificationPopup
                open={!!pendingUnenrollFactorId}
                onCancel={() => setPendingUnenrollFactorId(null)}
                onVerified={() => {
                    const factorId = pendingUnenrollFactorId;
                    setPendingUnenrollFactorId(null);
                    if (factorId) void unenrollFactor(factorId);
                }}
            />
            <MfaVerificationPopup
                open={pendingLoginPreference !== null}
                onCancel={() => setPendingLoginPreference(null)}
                onVerified={() => {
                    const enabled = pendingLoginPreference;
                    setPendingLoginPreference(null);
                    if (enabled !== null) void saveLoginPreference(enabled);
                }}
                title="Authenticator required"
                message="Enter a code from your authenticator app to change login verification."
            />
        </div>
    );
}
