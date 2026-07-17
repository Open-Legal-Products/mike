"use client";

import { createContext, useContext } from "react";

interface SidebarContextValue {
    setSidebarOpen: (open: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextValue>({
    setSidebarOpen: () => {},
});

export function useSidebar() {
    return useContext(SidebarContext);
}
