import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useSelectedModel } from "./useSelectedModel";
import { canonicalModelId } from "../components/assistant/ModelToggle";

const STORAGE_KEY = "mike.selectedModel";

beforeEach(() => {
    window.localStorage.clear();
});

describe("useSelectedModel", () => {
    it("canonicalizes stored ids before validating them", () => {
        // The current LEGACY_MODEL_IDS targets are settings-tier models, so
        // after mapping they still resolve to the composer default here — the
        // mapping's user-visible effect lives on the settings page. This
        // pins that reads go through canonicalModelId (a future rename of a
        // composer-tier model is then handled for free).
        window.localStorage.setItem(STORAGE_KEY, "gpt-5.4-lite");

        const { result } = renderHook(() => useSelectedModel());

        expect(result.current[0]).toBe("gemini-3-flash-preview");
    });

    it("persists a valid explicit selection", () => {
        const { result } = renderHook(() => useSelectedModel());

        act(() => result.current[1]("claude-fable-5"));

        expect(result.current[0]).toBe("claude-fable-5");
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe("claude-fable-5");
    });

    it("keeps a router selection that is in the loaded saved lists", () => {
        window.localStorage.setItem(STORAGE_KEY, "openrouter/openai/gpt-5.4");

        const { result } = renderHook(() =>
            useSelectedModel({
                openRouterModels: ["openai/gpt-5.4"],
                vercelModels: [],
                openCodeGoModels: [],
                syntheticModels: [],
            }),
        );

        expect(result.current[0]).toBe("openrouter/openai/gpt-5.4");
    });

    it("resets a router selection missing from the loaded saved lists", () => {
        window.localStorage.setItem(STORAGE_KEY, "openrouter/pricy/frontier");

        const { result } = renderHook(() =>
            useSelectedModel({
                openRouterModels: ["openai/gpt-5.4"],
                vercelModels: [],
                openCodeGoModels: [],
                syntheticModels: [],
            }),
        );

        expect(result.current[0]).toBe("gemini-3-flash-preview");
        expect(window.localStorage.getItem(STORAGE_KEY)).toBe(
            "gemini-3-flash-preview",
        );
    });

    it("keeps an OpenCode Go selection that is in the loaded saved lists", () => {
        window.localStorage.setItem(STORAGE_KEY, "opencode-go/glm-5");

        const { result } = renderHook(() =>
            useSelectedModel({
                openRouterModels: [],
                vercelModels: [],
                openCodeGoModels: ["glm-5"],
                syntheticModels: [],
            }),
        );

        expect(result.current[0]).toBe("opencode-go/glm-5");
    });

    it("resets an OpenCode Go selection the user no longer has saved", () => {
        window.localStorage.setItem(STORAGE_KEY, "opencode-go/kimi-k3");

        const { result } = renderHook(() =>
            useSelectedModel({
                openRouterModels: [],
                vercelModels: [],
                openCodeGoModels: ["glm-5"],
                syntheticModels: [],
            }),
        );

        expect(result.current[0]).toBe("gemini-3-flash-preview");
    });

    it("keeps a Synthetic selection whose id contains colons", () => {
        window.localStorage.setItem(STORAGE_KEY, "synthetic/syn:large:text");

        const { result } = renderHook(() =>
            useSelectedModel({
                openRouterModels: [],
                vercelModels: [],
                openCodeGoModels: [],
                syntheticModels: ["syn:large:text"],
            }),
        );

        expect(result.current[0]).toBe("synthetic/syn:large:text");
    });

    it("leaves a router selection alone while the lists are still loading", () => {
        window.localStorage.setItem(STORAGE_KEY, "openrouter/openai/gpt-5.4");

        const { result } = renderHook(() => useSelectedModel(null));

        expect(result.current[0]).toBe("openrouter/openai/gpt-5.4");
    });
});

describe("canonicalModelId", () => {
    it("maps only known legacy ids", () => {
        expect(canonicalModelId("gemini-3.1-flash-lite-preview")).toBe(
            "gemini-3.5-flash-lite",
        );
        expect(canonicalModelId("gpt-5.4-lite")).toBe("gpt-5.4-mini");
        expect(canonicalModelId("claude-fable-5")).toBe("claude-fable-5");
    });
});
