"use client";

import React, { createContext, useContext, ReactNode } from "react";

interface User {
    id: string;
    email: string;
}

interface AuthContextType {
    user: User;
    isAuthenticated: boolean;
    authLoading: boolean;
    signOut: () => Promise<void>;
}

const INTERNAL_USER: User = { id: "internal", email: "internal@carbonleo.com" };

const AuthContext = createContext<AuthContextType>({
    user: INTERNAL_USER,
    isAuthenticated: true,
    authLoading: false,
    signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
    return (
        <AuthContext.Provider value={{ user: INTERNAL_USER, isAuthenticated: true, authLoading: false, signOut: async () => {} }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
