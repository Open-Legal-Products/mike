"use client";

import { Suspense } from "react";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { UserProfileProvider } from "@/contexts/UserProfileContext";
import { MfaLoginGate } from "@/app/components/shared/MfaLoginGate";
import { QueryClientProvider } from "@/components/query-client-provider";

export function Providers({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider>
            <AuthProvider>
                <UserProfileProvider>
                    <Suspense fallback={<ProviderLoader />}>
                        <MfaLoginGate>{children}</MfaLoginGate>
                    </Suspense>
                    <Toaster richColors position="top-right" />
                </UserProfileProvider>
            </AuthProvider>
        </QueryClientProvider>
    );
}

function ProviderLoader() {
    return (
        <div className="flex min-h-dvh items-center justify-center bg-gray-50/80">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
        </div>
    );
}
