"use client";

import React, {
    createContext,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

interface User {
    id: string;
    email: string;
    pendingEmail?: string | null;
}

interface AuthContextType {
    user: User | null;
    isAuthenticated: boolean;
    authLoading: boolean;
    signOut: () => Promise<void>;
    updateEmail: (email: string) => Promise<User>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function toUser(user: SupabaseUser): User {
    return {
        id: user.id,
        email: user.email || "",
        pendingEmail: user.new_email ?? null,
    };
}

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [authLoading, setAuthLoading] = useState(true);

    useEffect(() => {
        const checkUser = async () => {
            const {
                data: { session },
            } = await supabase.auth.getSession();

            if (session?.user) {
                setUser(toUser(session.user));
            }
            setAuthLoading(false);
        };

        checkUser();

        const {
            data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (session?.user) {
                setUser(toUser(session.user));
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
        await supabase.auth.signOut({ scope: "local" });
        setUser(null);
    };

    const updateEmail = async (email: string) => {
        const redirectTo =
            typeof window === "undefined"
                ? undefined
                : `${window.location.origin}/account`;
        const { data, error } = await supabase.auth.updateUser(
            { email },
            redirectTo ? { emailRedirectTo: redirectTo } : undefined,
        );

        if (error) throw error;
        if (!data.user) throw new Error("Unable to update email");

        const nextUser = toUser(data.user);
        setUser(nextUser);
        return nextUser;
    };

    return (
        <AuthContext.Provider
            value={{
                user,
                isAuthenticated: !!user,
                authLoading,
                signOut,
                updateEmail,
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
