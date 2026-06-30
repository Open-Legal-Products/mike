import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkflowsQuery } from "./useWorkflowsQuery";

const listWorkflows = vi.fn();
const listHiddenWorkflows = vi.fn();

vi.mock("@/app/lib/mikeApi", () => ({
    listWorkflows: (type: string) => listWorkflows(type),
    listHiddenWorkflows: () => listHiddenWorkflows(),
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

describe("useWorkflowsQuery", () => {
    beforeEach(() => {
        listWorkflows.mockReset();
        listHiddenWorkflows.mockReset();
    });

    it("merges assistant + tabular workflows and hidden ids when enabled", async () => {
        listWorkflows.mockImplementation((type: string) =>
            Promise.resolve(
                type === "assistant"
                    ? [{ id: "a1", type: "assistant" }]
                    : [{ id: "t1", type: "tabular" }],
            ),
        );
        listHiddenWorkflows.mockResolvedValue(["builtin-1"]);

        const { result } = renderHook(() => useWorkflowsQuery(), { wrapper });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual({
            custom: [
                { id: "a1", type: "assistant" },
                { id: "t1", type: "tabular" },
            ],
            hiddenBuiltinIds: ["builtin-1"],
        });
        expect(listWorkflows).toHaveBeenCalledWith("assistant");
        expect(listWorkflows).toHaveBeenCalledWith("tabular");
        expect(listHiddenWorkflows).toHaveBeenCalledTimes(1);
    });

    it("stays idle and does not fetch while disabled", () => {
        listWorkflows.mockResolvedValue([]);
        listHiddenWorkflows.mockResolvedValue([]);

        const { result } = renderHook(() => useWorkflowsQuery(false), {
            wrapper,
        });

        expect(result.current.fetchStatus).toBe("idle");
        expect(listWorkflows).not.toHaveBeenCalled();
        expect(listHiddenWorkflows).not.toHaveBeenCalled();
    });
});
