"use client";

import { createContext, useContext, ReactNode } from "react";

interface UserProfile {
    displayName: string | null;
    organisation: string | null;
    messageCreditsUsed: number;
    creditsResetDate: string;
    creditsRemaining: number;
    tier: string;
    tabularModel: string;
    claudeApiKey: string | null;
    geminiApiKey: string | null;
}

interface UserProfileContextType {
    profile: UserProfile;
    loading: boolean;
    updateDisplayName: (name: string) => Promise<boolean>;
    updateOrganisation: (organisation: string) => Promise<boolean>;
    updateModelPreference: (field: "tabularModel", value: string) => Promise<boolean>;
    updateApiKey: (provider: "claude" | "gemini", value: string | null) => Promise<boolean>;
    reloadProfile: () => Promise<void>;
    incrementMessageCredits: () => Promise<boolean>;
}

const STATIC_PROFILE: UserProfile = {
    displayName: "Carbonleo",
    organisation: "Carbonleo",
    messageCreditsUsed: 0,
    creditsResetDate: "2099-01-01T00:00:00.000Z",
    creditsRemaining: 999999,
    tier: "Pro",
    tabularModel: "gemini-3-flash-preview",
    claudeApiKey: process.env.NEXT_PUBLIC_ANTHROPIC_API_KEY || null,
    geminiApiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || null,
};

const UserProfileContext = createContext<UserProfileContextType>({
    profile: STATIC_PROFILE,
    loading: false,
    updateDisplayName: async () => true,
    updateOrganisation: async () => true,
    updateModelPreference: async () => true,
    updateApiKey: async () => true,
    reloadProfile: async () => {},
    incrementMessageCredits: async () => true,
});

export function UserProfileProvider({ children }: { children: ReactNode }) {
    return (
        <UserProfileContext.Provider value={{
            profile: STATIC_PROFILE,
            loading: false,
            updateDisplayName: async () => true,
            updateOrganisation: async () => true,
            updateModelPreference: async () => true,
            updateApiKey: async () => true,
            reloadProfile: async () => {},
            incrementMessageCredits: async () => true,
        }}>
            {children}
        </UserProfileContext.Provider>
    );
}

export function useUserProfile() {
    return useContext(UserProfileContext);
}
