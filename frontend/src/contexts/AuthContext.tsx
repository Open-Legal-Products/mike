"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";
import { isLocalMode, getLocalUser, clearToken } from "@/lib/localAuth";

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
        if (isLocalMode()) {
            // Local mode: read JWT from localStorage synchronously
            const localUser = getLocalUser();
            setUser(localUser);
            setAuthLoading(false);
            return;
        }

        // Supabase mode
        let subscription: { unsubscribe: () => void } | null = null;

        const initSupabase = async () => {
            const { supabase } = await import("@/lib/supabase");
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
                setUser({ id: session.user.id, email: session.user.email ?? "" });
            }
            setAuthLoading(false);

            const { data } = supabase.auth.onAuthStateChange((_event, session) => {
                if (session?.user) {
                    setUser({ id: session.user.id, email: session.user.email ?? "" });
                } else {
                    setUser(null);
                }
                setAuthLoading(false);
            });
            subscription = data.subscription;
        };

        initSupabase();
        return () => { subscription?.unsubscribe(); };
    }, []);

    const signOut = async () => {
        if (isLocalMode()) {
            clearToken();
            setUser(null);
            return;
        }
        const { supabase } = await import("@/lib/supabase");
        await supabase.auth.signOut();
        setUser(null);
    };

    return (
        <AuthContext.Provider
            value={{ user, isAuthenticated: !!user, authLoading, signOut }}
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
