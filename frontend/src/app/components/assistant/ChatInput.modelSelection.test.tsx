import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { ChatInput } from "./ChatInput";

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: vi.fn(async () => []),
    uploadProjectDocument: vi.fn(),
    uploadStandaloneDocument: vi.fn(),
}));

vi.mock("@/app/contexts/UserProfileContext", () => ({
    useUserProfile: vi.fn(),
}));

vi.mock("@/app/lib/modelAvailability", () => ({
    getModelProvider: vi.fn(),
    isModelAvailable: vi.fn(() => true),
}));

// The real module is kept for its constants — useSelectedModel imports
// ALLOWED_MODEL_IDS/DEFAULT_MODEL_ID/canonicalModelId from it, and this test
// exercises the real hook.
vi.mock("./ModelToggle", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./ModelToggle")>()),
    ModelToggle: () => null,
}));

vi.mock("./AddDocButton", () => ({ AddDocButton: () => null }));
vi.mock("./UploadOverlay", () => ({ UploadOverlay: () => null }));
vi.mock("../shared/FileTypeIcon", () => ({ FileTypeIcon: () => null }));
vi.mock("../modals/AddDocumentsModal", () => ({
    AddDocumentsModal: () => null,
}));
vi.mock("./AssistantWorkflowModal", () => ({
    AssistantWorkflowModal: () => null,
}));
vi.mock("../popups/ApiKeyMissingPopup", () => ({
    ApiKeyMissingPopup: () => null,
}));

const STORAGE_KEY = "mike.selectedModel";
const STORED = "openrouter/pricy/frontier";

class ResizeObserverMock {
    observe() {}
    disconnect() {}
}

function emptyApiKeys() {
    return {
        claude: { configured: false, source: null },
        gemini: { configured: false, source: null },
        openai: { configured: false, source: null },
        openrouter: { configured: false, source: null },
        vercel: { configured: false, source: null },
        courtlistener: { configured: false, source: null },
    };
}

function mockProfile(apiKeysDegraded: boolean) {
    vi.mocked(useUserProfile).mockReturnValue({
        profile: {
            openRouterModels: [],
            vercelModels: [],
            openCodeGoModels: [],
            syntheticModels: [],
            apiKeys: emptyApiKeys(),
        },
        loading: false,
        apiKeysDegraded,
    } as unknown as ReturnType<typeof useUserProfile>);
}

describe("ChatInput model selection vs. a degraded profile", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.localStorage.clear();
        vi.stubGlobal("ResizeObserver", ResizeObserverMock);
    });

    it("keeps the stored router selection when the profile is degraded", async () => {
        // A dropped /user/profile request answers with the local fallback,
        // whose router lists are empty because the truth is UNKNOWN — not
        // because the user deselected everything. Resetting on that would
        // permanently rewrite localStorage from one failed request.
        window.localStorage.setItem(STORAGE_KEY, STORED);
        mockProfile(true);

        render(
            <ChatInput
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        await waitFor(() =>
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe(STORED),
        );
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(STORED);
    });

    it("still resets a stale router selection on a healthy empty profile", async () => {
        // A real profile that reports no saved router models is authoritative:
        // the stale selection must reset, exactly as before.
        window.localStorage.setItem(STORAGE_KEY, STORED);
        mockProfile(false);

        render(
            <ChatInput
                onSubmit={vi.fn()}
                onCancel={vi.fn()}
                isLoading={false}
            />,
        );

        await waitFor(() =>
            expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
                "gemini-3-flash-preview",
            ),
        );
    });
});
