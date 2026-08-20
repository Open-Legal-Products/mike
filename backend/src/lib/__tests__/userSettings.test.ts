import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUserApiKeys, getAllUserRouterModels } = vi.hoisted(() => ({
    getUserApiKeys: vi.fn(),
    getAllUserRouterModels: vi.fn(),
}));

vi.mock("../userApiKeys", () => ({
    getUserApiKeys: (...args: unknown[]) => getUserApiKeys(...args),
}));

vi.mock("../routerModels", async () => ({
    ...(await vi.importActual<typeof import("../routerModels")>(
        "../routerModels",
    )),
    getAllUserRouterModels: (...args: unknown[]) =>
        getAllUserRouterModels(...args),
}));

vi.mock("../supabase", () => ({ createServerSupabase: vi.fn() }));

import { getUserModelSettings } from "../userSettings";

function profileDb(row: Record<string, unknown> | null) {
    const chain: Record<string, unknown> = {};
    for (const method of ["from", "select", "eq"]) {
        chain[method] = vi.fn(() => chain);
    }
    chain.single = vi.fn(async () => ({ data: row, error: null }));
    return chain as never;
}

const NO_KEYS = {
    claude: null,
    gemini: "env-gemini-key",
    openai: null,
    openrouter: "env-openrouter-key",
    vercel: null,
    courtlistener: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    getUserApiKeys.mockResolvedValue(NO_KEYS);
    getAllUserRouterModels.mockResolvedValue({
        openrouter: ["allowed/model"],
        vercel: [],
        "opencode-go": [],
        synthetic: [],
    });
});

describe("getUserModelSettings router-model allowlist", () => {
    it("keeps a stored router preference that is in the saved selection", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "openrouter/allowed/model",
                tabular_model: "openrouter/allowed/model",
                legal_research_us: true,
            }),
        );

        expect(settings.title_model).toBe("openrouter/allowed/model");
        expect(settings.tabular_model).toBe("openrouter/allowed/model");
    });

    it("falls back when a stored router preference is outside the saved selection", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "openrouter/pricy/frontier-model",
                tabular_model: "vercel/pricy/frontier-model",
                legal_research_us: true,
            }),
        );

        // Gemini env key present → cheap default title model; tabular default.
        expect(settings.title_model).toBe("gemini-3.5-flash-lite");
        expect(settings.tabular_model).toBe("gemini-3-flash-preview");
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    it("keeps first-party preferences untouched", async () => {
        const settings = await getUserModelSettings(
            "user-1",
            profileDb({
                title_model: "claude-haiku-4-5",
                tabular_model: "claude-sonnet-5",
                legal_research_us: true,
            }),
        );

        expect(settings.title_model).toBe("claude-haiku-4-5");
        expect(settings.tabular_model).toBe("claude-sonnet-5");
    });
});
