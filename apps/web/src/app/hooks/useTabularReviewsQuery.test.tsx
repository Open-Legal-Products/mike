import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useTabularReviewsQuery } from "./useTabularReviewsQuery";

const listTabularReviews = vi.fn();

vi.mock("@/app/lib/mikeApi", () => ({
    listTabularReviews: () => listTabularReviews(),
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

describe("useTabularReviewsQuery", () => {
    beforeEach(() => {
        listTabularReviews.mockReset();
    });

    it("fetches the tabular-reviews list when enabled", async () => {
        const reviews = [{ id: "r1", title: "Review" }];
        listTabularReviews.mockResolvedValue(reviews);

        const { result } = renderHook(() => useTabularReviewsQuery(), {
            wrapper,
        });

        await waitFor(() => expect(result.current.isSuccess).toBe(true));
        expect(result.current.data).toEqual(reviews);
        expect(listTabularReviews).toHaveBeenCalledTimes(1);
    });

    it("stays idle and does not fetch while disabled", () => {
        listTabularReviews.mockResolvedValue([]);

        const { result } = renderHook(() => useTabularReviewsQuery(false), {
            wrapper,
        });

        expect(result.current.fetchStatus).toBe("idle");
        expect(listTabularReviews).not.toHaveBeenCalled();
    });
});
