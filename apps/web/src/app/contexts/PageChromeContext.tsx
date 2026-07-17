"use client";

import { createContext, useContext } from "react";

interface PageChromeContextValue {
    mobileActionsContainer: HTMLElement | null;
}

export const PageChromeContext = createContext<PageChromeContextValue>({
    mobileActionsContainer: null,
});

export function usePageChrome() {
    return useContext(PageChromeContext);
}
