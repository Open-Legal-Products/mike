"use client";

import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/app/contexts/AuthContext";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { needsMfaVerification } from "../popups/MfaVerificationPopup";

type GateState = "idle" | "checking" | "required" | "verified";
const MFA_VERIFIED_AT_KEY = "mike:mfa-verified-at";
const MFA_VERIFIED_GRACE_MS = 60_000;

export function MfaLoginGate({ children }: { children: ReactNode }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const { user } = useAuth();
    const { profile, loading } = useUserProfile();
    const [gateState, setGateState] = useState<GateState>("idle");
    const isVerifyPage = pathname === "/verify-mfa";

    useEffect(() => {
        if (!user) {
            setGateState("idle");
            return;
        }
        if (loading) {
            return;
        }
        if (!profile?.mfaOnLogin) {
            setGateState("idle");
            return;
        }

        if (hasRecentMfaVerification()) {
            setGateState("verified");
            return;
        }

        let cancelled = false;
        setGateState((previous) =>
            previous === "verified" ? "verified" : "checking",
        );

        async function checkLoginMfa() {
            try {
                const required = await needsMfaVerification();
                if (cancelled) return;
                setGateState(required ? "required" : "verified");
            } catch {
                if (!cancelled) setGateState("required");
            }
        }

        void checkLoginMfa();

        return () => {
            cancelled = true;
        };
    }, [loading, profile?.mfaOnLogin, user?.id]);

    useEffect(() => {
        if (!user || loading || !profile?.mfaOnLogin) return;

        if (gateState === "required" && !isVerifyPage) {
            if (hasRecentMfaVerification()) {
                setGateState("verified");
                return;
            }
            const search = searchParams.toString();
            const next = `${pathname}${search ? `?${search}` : ""}`;
            router.replace(`/verify-mfa?next=${encodeURIComponent(next)}`);
        } else if (gateState === "verified" && isVerifyPage) {
            const next = safeNextPath(searchParams.get("next"));
            router.replace(next);
        }
    }, [
        gateState,
        isVerifyPage,
        loading,
        pathname,
        profile?.mfaOnLogin,
        router,
        searchParams,
        user,
    ]);

    if (user && loading) {
        return gateState === "verified" ? (
            <>{children}</>
        ) : (
            <FullScreenGateLoader />
        );
    }

    if (user && profile?.mfaOnLogin) {
        if (gateState === "required" && isVerifyPage) {
            return <>{children}</>;
        }
        if (gateState === "verified" && isVerifyPage) {
            return <FullScreenGateLoader />;
        }
        if (gateState === "verified") {
            return <>{children}</>;
        }
        if (gateState === "required" && !isVerifyPage) {
            return <FullScreenGateLoader />;
        }
        return <FullScreenGateLoader />;
    }

    return <>{children}</>;
}

function safeNextPath(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) {
        return "/assistant";
    }
    if (value.startsWith("/verify-mfa")) return "/assistant";
    return value;
}

function FullScreenGateLoader() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-gray-50/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
        </div>
    );
}

export function markMfaVerifiedForGate() {
    window.sessionStorage.setItem(MFA_VERIFIED_AT_KEY, String(Date.now()));
}

function hasRecentMfaVerification() {
    const raw = window.sessionStorage.getItem(MFA_VERIFIED_AT_KEY);
    const verifiedAt = raw ? Number.parseInt(raw, 10) : 0;
    return (
        Number.isFinite(verifiedAt) &&
        Date.now() - verifiedAt < MFA_VERIFIED_GRACE_MS
    );
}
