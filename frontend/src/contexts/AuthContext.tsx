"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";

interface User {
    id: string;
    email: string;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    authLoading: boolean;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        const scoutAllowedOrigin =
            process.env.NEXT_PUBLIC_SCOUT_ALLOWED_ORIGIN ||
            "http://localhost:3000";

        const tryBootstrapEmbeddedSession = async (): Promise<boolean> => {
            if (typeof window === "undefined") return false;
            if (window.self === window.top) return false;

            return new Promise((resolve) => {
                let settled = false;
                const settle = (value: boolean) => {
                    if (settled) return;
                    settled = true;
                    window.removeEventListener("message", onMessage);
                    resolve(value);
                };

                const onMessage = async (event: MessageEvent) => {
                    if (event.origin !== scoutAllowedOrigin) return;
                    if (event.data?.type !== "SCOUT_SUPABASE_SESSION") return;
                    const accessToken = event.data?.payload?.access_token;
                    const refreshToken = event.data?.payload?.refresh_token;
                    if (!accessToken || !refreshToken) return;

                    const { error } = await supabase.auth.setSession({
                        access_token: accessToken,
                        refresh_token: refreshToken,
                    });
                    if (!error) {
                        settle(true);
                    }
                };

                window.addEventListener("message", onMessage);
                window.setTimeout(() => settle(false), 2500);
            });
        };

        const ensureProfile = async (accessToken: string) => {
            const apiBase =
                process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
            await fetch(`${apiBase}/user/profile`, {
                method: "POST",
                headers: { Authorization: `Bearer ${accessToken}` },
            }).catch((e) => {
                console.log(e);
            });
        };

        const checkUser = async () => {
            await tryBootstrapEmbeddedSession();
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (session?.user) {
                setUser({
                    id: session.user.id,
                    email: session.user.email || "",
                });
                ensureProfile(session.access_token);
            }
            setAuthLoading(false);
        };

        checkUser();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (session?.user) {
                setUser({
                    id: session.user.id,
                    email: session.user.email || "",
                });
                ensureProfile(session.access_token);
            } else {
                setUser(null);
            }
            setAuthLoading(false);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const signOut = async () => {
        await supabase.auth.signOut();
        setUser(null);
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                authLoading,
                signOut,
            }}
        >
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error("useAuth must be used within an AuthProvider");
    }
    return context;
}
