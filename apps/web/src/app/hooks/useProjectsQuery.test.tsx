import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectsQuery } from "./useProjectsQuery";

const listProjects = vi.fn();

vi.mock("@/app/lib/mikeApi", () => ({
    listProjects: () => listProjects(),
}));

function wrapper({ children }: { children: ReactNode }) {
    // A fresh client per test with retries off keeps the test deterministic.
    const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
    });
    return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
}

describe("useProjectsQuery", () => {
    beforeEach(() => {
        listProjects.mockReset();
    });

    it("fetches the projects list when enabled", async () => {
        const projects = [{ id: "p1", name: "Alpha" }];
        listProjects.mockResolvedValue(projects);

        const { result } = renderHook(() => useProjectsQuery(true), {
            wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(projects);
        expect(listProjects).toHaveBeenCalledTimes(1);
    });

    it("stays idle and does not fetch while disabled", () => {
        listProjects.mockResolvedValue([]);

        const { result } = renderHook(() => useProjectsQuery(false), {
            wrapper,
        });

        expect(result.current.fetchStatus).toBe("idle");
        expect(listProjects).not.toHaveBeenCalled();
    });
});
