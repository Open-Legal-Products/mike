"use client";

import { UserProfileProvider } from "@/contexts/UserProfileContext";

export function Providers({ children }: { children: React.ReactNode }) {
    return <UserProfileProvider>{children}</UserProfileProvider>;
}
