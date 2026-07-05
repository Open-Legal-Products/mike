"use client";

import { Suspense } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { UserProfileProvider } from "@/contexts/UserProfileContext";
import { MfaLoginGate } from "@/app/components/shared/MfaLoginGate";
import { FullScreenLoader } from "@/app/components/shared/FullScreenLoader";
import { QueryClientProvider } from "@/components/query-client-provider";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider>
            <AuthProvider>
                <UserProfileProvider>
                    <Suspense fallback={<FullScreenLoader />}>
                        <MfaLoginGate>{children}</MfaLoginGate>
                    </Suspense>
                    <Toaster richColors position="top-right" />
                </UserProfileProvider>
            </AuthProvider>
        </QueryClientProvider>
    );
}
