"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Menu } from "lucide-react";
import { ChatHistoryProvider } from "@/app/contexts/ChatHistoryContext";
import { SidebarContext } from "@/app/contexts/SidebarContext";
import { AppSidebar } from "@/app/components/shared/AppSidebar";
import { useAuth } from "@/contexts/AuthContext";

function AppLayout({ children }: { children: React.ReactNode }) {
    const [isSidebarOpenDesktop, setIsSidebarOpenDesktop] = useState(() => {
        if (typeof window !== "undefined") {
            const saved = localStorage.getItem("sidebarOpen");
            return saved !== null ? saved === "true" : true;
        }
        return true;
    });

    const [isSidebarOpen, setIsSidebarOpen] = useState(() => {
        if (typeof window !== "undefined" && window.innerWidth < 768) {
            return false;
        }
        return true;
    });

    useEffect(() => {
        if (typeof window !== "undefined" && window.innerWidth >= 768) {
            localStorage.setItem("sidebarOpen", isSidebarOpen.toString());
        }
    }, [isSidebarOpenDesktop]);

    useEffect(() => {
        if (typeof window === "undefined") return;
        const handleResize = () => {
            const isSmall = window.innerWidth < 768;
            if (isSmall && isSidebarOpen) setIsSidebarOpen(false);
            else if (!isSmall && !isSidebarOpen)
                setIsSidebarOpen(isSidebarOpenDesktop);
        };
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, [isSidebarOpen, isSidebarOpenDesktop]);

    const handleSidebarToggle = () => {
        if (window.innerWidth >= 768) {
            setIsSidebarOpenDesktop(!isSidebarOpenDesktop);
            setIsSidebarOpen(!isSidebarOpenDesktop);
        } else {
            setIsSidebarOpen(!isSidebarOpen);
        }
    };

    return (
        <ChatHistoryProvider>
            <SidebarContext.Provider
                value={{ setSidebarOpen: (open) => { setIsSidebarOpen(open); setIsSidebarOpenDesktop(open); } }}
            >
                <div className="h-dvh bg-background flex flex-col">
                    <div className="flex-1 flex overflow-hidden">
                        <AppSidebar
                            isOpen={isSidebarOpen}
                            onToggle={handleSidebarToggle}
                        />
                        <div className="flex-1 flex flex-col h-dvh md:overflow-hidden relative w-full">
                            <div className="flex md:hidden items-center gap-3 px-4 py-3 border-b border-border shrink-0">
                                <button
                                    onClick={handleSidebarToggle}
                                    className="flex items-center justify-center w-8 h-8 rounded hover:bg-accent text-foreground/60 transition-colors"
                                >
                                    <Menu className="h-5 w-5" />
                                </button>
                            </div>
                            <main className="flex-1 overflow-y-auto md:overflow-hidden w-full h-full">
                                {children}
                            </main>
                        </div>
                    </div>
                </div>
            </SidebarContext.Provider>
        </ChatHistoryProvider>
    );
}

export default function MikeLayout({ children }: { children: React.ReactNode }) {
    const { isAuthenticated, authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading && !isAuthenticated) {
            router.replace("/login");
        }
    }, [isAuthenticated, authLoading, router]);

    if (authLoading) {
        return (
            <div className="h-dvh flex items-center justify-center bg-background">
                <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
            </div>
        );
    }

    if (!isAuthenticated) return null;

    return <AppLayout>{children}</AppLayout>;
}
