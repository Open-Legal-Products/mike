import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getUserProfile, updateUserProfile } = vi.hoisted(() => ({
    getUserProfile: vi.fn(),
    updateUserProfile: vi.fn(),
}));

vi.mock("@/app/contexts/AuthContext", () => ({
    useAuth: () => ({
        user: { id: "u1" },
        isAuthenticated: true,
    }),
}));

vi.mock("@/app/lib/mikeApi", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/app/lib/mikeApi")>()),
    getUserProfile: (...args: unknown[]) => getUserProfile(...args),
    updateUserProfile: (...args: unknown[]) => updateUserProfile(...args),
}));

import {
    UserProfileProvider,
    useUserProfile,
} from "./UserProfileContext";

function apiProfile(darkMode: boolean) {
    return {
        displayName: "Ada",
        organisation: null,
        messageCreditsUsed: 0,
        creditsResetDate: "2999-01-01T00:00:00.000Z",
        creditsRemaining: 999999,
        tier: "Free",
        titleModel: "gemini-3.1-flash-lite-preview",
        tabularModel: "gemini-3-flash-preview",
        mfaOnLogin: false,
        legalResearchUs: true,
        emailIntegrationEnabled: false,
        darkMode,
        featureFlags: {},
        deploymentModules: {},
        apiKeyStatus: {
            claude: false,
            kimi: false,
            gemini: false,
            openai: false,
            openrouter: false,
            courtlistener: false,
            sources: {},
        },
    };
}

function ThemeControls() {
    const { profile, updateDarkMode } = useUserProfile();
    return (
        <>
            <span data-testid="mode">{profile?.darkMode ? "dark" : "light"}</span>
            <button onClick={() => void updateDarkMode(false)}>Light</button>
            <button onClick={() => void updateDarkMode(true)}>Dark</button>
        </>
    );
}

beforeEach(() => {
    getUserProfile.mockResolvedValue(apiProfile(true));
    updateUserProfile.mockImplementation(({ darkMode }: { darkMode: boolean }) =>
        Promise.resolve(apiProfile(darkMode)),
    );
});

afterEach(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.style.colorScheme = "";
    vi.clearAllMocks();
});

describe("UserProfileProvider dark mode", () => {
    it("switches from dark to light and back to dark", async () => {
        render(
            <UserProfileProvider>
                <ThemeControls />
            </UserProfileProvider>,
        );

        await waitFor(() => {
            expect(screen.getByTestId("mode")).toHaveTextContent("dark");
            expect(document.documentElement).toHaveClass("dark");
        });

        fireEvent.click(screen.getByRole("button", { name: "Light" }));
        await waitFor(() => {
            expect(screen.getByTestId("mode")).toHaveTextContent("light");
            expect(document.documentElement).not.toHaveClass("dark");
        });

        fireEvent.click(screen.getByRole("button", { name: "Dark" }));
        await waitFor(() => {
            expect(screen.getByTestId("mode")).toHaveTextContent("dark");
            expect(document.documentElement).toHaveClass("dark");
        });

        expect(updateUserProfile).toHaveBeenNthCalledWith(1, {
            darkMode: false,
        });
        expect(updateUserProfile).toHaveBeenNthCalledWith(2, {
            darkMode: true,
        });
    });

    it("rolls the document theme back when persistence fails", async () => {
        updateUserProfile.mockRejectedValueOnce(new Error("save failed"));
        function FailingControl() {
            const { updateDarkMode } = useUserProfile();
            return (
                <button
                    onClick={() => {
                        void updateDarkMode(false).catch(() => {});
                    }}
                >
                    Light
                </button>
            );
        }
        render(
            <UserProfileProvider>
                <FailingControl />
            </UserProfileProvider>,
        );
        await waitFor(() => expect(document.documentElement).toHaveClass("dark"));

        fireEvent.click(screen.getByRole("button", { name: "Light" }));
        await waitFor(() => expect(document.documentElement).toHaveClass("dark"));
    });
});
