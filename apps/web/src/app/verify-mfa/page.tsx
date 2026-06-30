"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { SiteLogo } from "@/components/site-logo";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
    needsMfaVerification,
    VerificationCodeInput,
} from "@/app/components/shared/MfaVerificationPopup";
import { markMfaVerifiedForGate } from "@/app/components/shared/MfaLoginGate";

type MfaFactor = {
    id: string;
    friendly_name?: string | null;
    factor_type: string;
};

const authGlassCardClassName =
    "rounded-2xl border border-white/70 bg-white/72 px-8 py-8 shadow-[0_4px_14px_rgba(15,23,42,0.045),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-8px_18px_rgba(255,255,255,0.12)] backdrop-blur-2xl";

export default function VerifyMfaPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const { user, authLoading, signOut } = useAuth();
    const [factors, setFactors] = useState<MfaFactor[]>([]);
    const [selectedFactorId, setSelectedFactorId] = useState("");
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(true);
    const [verifying, setVerifying] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const nextPath = safeNextPath(searchParams.get("next"));
    const canVerify =
        !loading && !verifying && !!selectedFactorId && code.trim().length === 6;

    useEffect(() => {
        if (authLoading) return;
        if (!user) {
            router.replace("/login");
            return;
        }

        let cancelled = false;

        async function loadMfaState() {
            setLoading(true);
            setError(null);
            setCode("");
            try {
                const required = await needsMfaVerification();
                if (cancelled) return;
                if (!required) {
                    router.replace(nextPath);
                    return;
                }

                const { data, error: factorError } =
                    await supabase.auth.mfa.listFactors();
                if (cancelled) return;
                if (factorError) throw factorError;

                const verified = (data.totp ?? []) as MfaFactor[];
                setFactors(verified);
                setSelectedFactorId(verified[0]?.id ?? "");
                if (verified.length === 0) {
                    setError(
                        "No verified authenticator factor is available for this account.",
                    );
                }
            } catch (loadError) {
                if (cancelled) return;
                setError(
                    loadError instanceof Error
                        ? loadError.message
                        : "Unable to load authenticator verification.",
                );
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        void loadMfaState();

        return () => {
            cancelled = true;
        };
    }, [authLoading, nextPath, router, user]);

    async function verify() {
        if (!canVerify) return;

        setVerifying(true);
        setError(null);
        const { error: verifyError } =
            await supabase.auth.mfa.challengeAndVerify({
                factorId: selectedFactorId,
                code: code.trim(),
            });
        setVerifying(false);

        if (verifyError) {
            setError(verifyError.message);
            return;
        }

        setCode("");
        markMfaVerifiedForGate();
        router.replace(nextPath);
    }

    async function cancel() {
        await signOut();
        router.replace("/login");
    }

    return (
        <div className="relative flex min-h-dvh items-start justify-center bg-gray-50/80 px-6 pb-10 pt-32 md:pt-40">
            <div className="absolute left-1/2 top-4 -translate-x-1/2 md:top-8">
                <SiteLogo size="lg" asLink />
            </div>
            <div className={`w-full max-w-md ${authGlassCardClassName}`}>
                <div className="mb-8 space-y-2">
                    <h1 className="text-2xl font-serif">
                        Verify your identity
                    </h1>
                    <p className="text-sm text-gray-500">
                        Enter the six-digit code from your authenticator app to
                        continue.
                    </p>
                </div>

                <div className="space-y-6">
                    {loading ? (
                        <div className="flex h-13 items-center justify-center text-sm text-gray-500">
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Loading authenticator...
                        </div>
                    ) : factors.length === 0 ? (
                        <p className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600">
                            No verified authenticator factor is available for
                            this session.
                        </p>
                    ) : (
                        <>
                            {factors.length > 1 && (
                                <select
                                    value={selectedFactorId}
                                    onChange={(event) =>
                                        setSelectedFactorId(event.target.value)
                                    }
                                    className="h-9 w-full rounded-lg border border-transparent bg-gray-100 px-3 text-sm text-gray-900 shadow-none outline-none focus-visible:border-gray-200 focus-visible:ring-2 focus-visible:ring-gray-300/45"
                                >
                                    {factors.map((factor) => (
                                        <option
                                            key={factor.id}
                                            value={factor.id}
                                        >
                                            {factor.friendly_name ||
                                                "Authenticator app"}
                                        </option>
                                    ))}
                                </select>
                            )}
                            <VerificationCodeInput
                                value={code}
                                onChange={setCode}
                                disabled={verifying}
                                autoFocus={!loading}
                                canSubmit={canVerify}
                                onSubmit={() => void verify()}
                            />
                        </>
                    )}

                    {error && <p className="text-sm text-red-600">{error}</p>}

                    <div className="flex items-center justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={() => void cancel()}
                            disabled={verifying}
                            className="px-3 py-1.5 text-sm font-medium text-gray-600 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                            Cancel
                        </button>
                        <Button
                            type="button"
                            onClick={() => void verify()}
                            disabled={!canVerify}
                            className="inline-flex items-center justify-center gap-1.5 rounded-full border border-gray-700/40 bg-gray-950/88 px-4 py-1.5 text-sm font-medium text-white shadow-[0_3px_9px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.22),inset_0_-4px_9px_rgba(15,23,42,0.2)] backdrop-blur-xl transition-all hover:bg-gray-900/90 hover:text-white active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100"
                        >
                            {verifying ? (
                                <span className="inline-flex items-center gap-1.5">
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    Verifying...
                                </span>
                            ) : (
                                "Verify"
                            )}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

function safeNextPath(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
        return "/assistant";
    }
    if (value.startsWith("/verify-mfa")) return "/assistant";
    return value;
}
