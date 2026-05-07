"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
    useCallback,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE =
    process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const MONTHLY_CREDIT_LIMIT = 999999;

interface ServerProfile {
    display_name: string | null;
    organisation: string | null;
    message_credits_used: number;
    credits_reset_date: string;
    tier: string;
    tabular_model: string;
    has_claude_api_key: boolean;
    has_gemini_api_key: boolean;
}

interface UserProfile {
    displayName: string | null;
    organisation: string | null;
    messageCreditsUsed: number;
    creditsResetDate: string;
    creditsRemaining: number;
    tier: string;
    tabularModel: string;
    hasClaudeApiKey: boolean;
    hasGeminiApiKey: boolean;
}

interface UserProfileContextType {
    profile: UserProfile | null;
    loading: boolean;
    updateDisplayName: (name: string) => Promise<boolean>;
    updateOrganisation: (organisation: string) => Promise<boolean>;
    updateModelPreference: (
        field: "tabularModel",
        value: string,
    ) => Promise<boolean>;
    updateApiKey: (
        provider: "claude" | "gemini",
        value: string | null,
    ) => Promise<boolean>;
    reloadProfile: () => Promise<void>;
    incrementMessageCredits: () => Promise<boolean>;
}

const UserProfileContext = createContext<UserProfileContextType | undefined>(
    undefined,
);

async function getAuthHeaders(): Promise<Record<string, string>> {
    const {
        data: { session },
    } = await supabase.auth.getSession();
    return session?.access_token
        ? { Authorization: `Bearer ${session.access_token}` }
        : {};
}

function fallbackProfile(): UserProfile {
    const reset = new Date();
    reset.setDate(reset.getDate() + 30);
    return {
        displayName: null,
        organisation: null,
        messageCreditsUsed: 0,
        creditsResetDate: reset.toISOString(),
        creditsRemaining: MONTHLY_CREDIT_LIMIT,
        tier: "Free",
        tabularModel: "gemini-3-flash-preview",
        hasClaudeApiKey: false,
        hasGeminiApiKey: false,
    };
}

function mapProfile(data: ServerProfile): UserProfile {
    const creditsUsed = data.message_credits_used ?? 0;
    return {
        displayName: data.display_name,
        organisation: data.organisation ?? null,
        messageCreditsUsed: creditsUsed,
        creditsResetDate: data.credits_reset_date,
        creditsRemaining: MONTHLY_CREDIT_LIMIT - creditsUsed,
        tier: data.tier || "Free",
        tabularModel: data.tabular_model || "gemini-3-flash-preview",
        hasClaudeApiKey: !!data.has_claude_api_key,
        hasGeminiApiKey: !!data.has_gemini_api_key,
    };
}

async function profileRequest(
    method: "GET" | "PATCH",
    body?: Record<string, unknown>,
): Promise<UserProfile> {
    const headers = await getAuthHeaders();
    const response = await fetch(`${API_BASE}/user/profile`, {
        method,
        cache: "no-store",
        headers: {
            Accept: "application/json",
            ...(body ? { "Content-Type": "application/json" } : {}),
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) throw new Error(await response.text());
    return mapProfile((await response.json()) as ServerProfile);
}

export function UserProfileProvider({ children }: { children: ReactNode }) {
    const { user, isAuthenticated } = useAuth();
    const [profile, setProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    const loadProfile = useCallback(async () => {
        try {
            setProfile(await profileRequest("GET"));
        } catch {
            setProfile(fallbackProfile());
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && user) {
            setLoading(true);
            loadProfile();
        } else {
            setProfile(null);
            setLoading(false);
        }
    }, [isAuthenticated, user, loadProfile]);

    const patchProfile = useCallback(async (body: Record<string, unknown>) => {
        try {
            const next = await profileRequest("PATCH", body);
            setProfile(next);
            return true;
        } catch {
            return false;
        }
    }, []);

    const updateDisplayName = useCallback(
        async (displayName: string): Promise<boolean> =>
            patchProfile({ display_name: displayName }),
        [patchProfile],
    );

    const updateOrganisation = useCallback(
        async (organisation: string): Promise<boolean> =>
            patchProfile({ organisation }),
        [patchProfile],
    );

    const updateModelPreference = useCallback(
        async (_field: "tabularModel", value: string): Promise<boolean> =>
            patchProfile({ tabular_model: value }),
        [patchProfile],
    );

    const updateApiKey = useCallback(
        async (
            provider: "claude" | "gemini",
            value: string | null,
        ): Promise<boolean> => patchProfile({ api_keys: { [provider]: value } }),
        [patchProfile],
    );

    const reloadProfile = useCallback(async () => {
        if (user) await loadProfile();
    }, [user, loadProfile]);

    const incrementMessageCredits = useCallback(async (): Promise<boolean> => {
        if (!user || !profile || profile.creditsRemaining <= 0) return false;
        return patchProfile({ increment_message_credits: true });
    }, [user, profile, patchProfile]);

    return (
        <UserProfileContext.Provider
            value={{
                profile,
                loading,
                updateDisplayName,
                updateOrganisation,
                updateModelPreference,
                updateApiKey,
                reloadProfile,
                incrementMessageCredits,
            }}
        >
            {children}
        </UserProfileContext.Provider>
    );
}

export function useUserProfile() {
    const context = useContext(UserProfileContext);
    if (context === undefined) {
        throw new Error(
            "useUserProfile must be used within a UserProfileProvider",
        );
    }
    return context;
}
