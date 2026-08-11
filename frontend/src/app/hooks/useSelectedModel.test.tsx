import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import {
    useReasoningEffort,
    useSelectedModel,
} from "./useSelectedModel";

describe("saved Claude controls", () => {
    beforeEach(() => window.localStorage.clear());

    it("migrates a saved Opus 4.7 selection to Opus 5", async () => {
        window.localStorage.setItem("mike.selectedModel", "claude-opus-4-7");

        const { result } = renderHook(() => useSelectedModel());

        await waitFor(() => expect(result.current[0]).toBe("claude-opus-5"));
        expect(window.localStorage.getItem("mike.selectedModel")).toBe(
            "claude-opus-5",
        );
    });

    it("defaults reasoning to medium and persists changes", () => {
        const { result } = renderHook(() => useReasoningEffort());

        expect(result.current[0]).toBe("medium");
        act(() => result.current[1]("low"));
        expect(result.current[0]).toBe("low");
        expect(window.localStorage.getItem("mike.reasoningEffort")).toBe("low");
    });
});
