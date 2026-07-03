"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { KeyRound, X } from "lucide-react";
import { useUserProfile } from "@/contexts/UserProfileContext";

const DISMISS_KEY = "apiKeyBannerDismissed";

// Providers that back a chat model. If none are configured the assistant can
// only answer in demo mode, so we surface a persistent setup nudge.
const MODEL_PROVIDERS = ["claude", "gemini", "openai"] as const;

/**
 * Global banner shown on every authenticated page when no AI provider key is
 * configured. Dismissible for the current tab session (sessionStorage) so it
 * returns on the next visit until a key is added. Hidden on the account/setup
 * pages where it would be redundant.
 */
export function ApiKeyBanner() {
    const { profile } = useUserProfile();
    const pathname = usePathname();
    const [dismissed, setDismissed] = useState(true);

    useEffect(() => {
        setDismissed(sessionStorage.getItem(DISMISS_KEY) === "true");
    }, []);

    // Wait for the profile before deciding, to avoid a flash on load.
    if (!profile) return null;
    if (dismissed) return null;
    if (pathname?.startsWith("/account")) return null;

    const anyConfigured = MODEL_PROVIDERS.some(
        (p) => profile.apiKeys[p]?.configured,
    );
    if (anyConfigured) return null;

    const handleDismiss = () => {
        sessionStorage.setItem(DISMISS_KEY, "true");
        setDismissed(true);
    };

    return (
        <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            <KeyRound className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="min-w-0 flex-1">
                <span className="font-medium">No AI provider key is set up.</span>{" "}
                <span className="text-amber-800">
                    Mike is answering in demo mode — add a key to get real
                    document analysis.
                </span>
            </p>
            <Link
                href="/account/api-keys"
                className="shrink-0 rounded-md bg-amber-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-amber-700"
            >
                Set up API keys
            </Link>
            <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss"
                className="shrink-0 rounded p-1 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
            >
                <X className="h-4 w-4" />
            </button>
        </div>
    );
}
