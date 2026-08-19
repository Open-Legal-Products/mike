"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/app/lib/supabase";
import { Input } from "@/app/components/ui/input";
import { PillButton } from "@/app/components/ui/pill-button";
import Link from "next/link";
import { SiteLogo } from "@/app/components/site-logo";
import { useAuth } from "@/app/contexts/AuthContext";
import { cn } from "@/app/lib/utils";
import {
    authGlassCardClassName,
    authInputClassName,
} from "@/app/components/auth/authStyles";

// The Mac desktop shell's preload bridge. Only its local ("everything on
// this Mac") mode answers guestCredentials with a value — in a browser the
// bridge doesn't exist, and against a hosted server it returns null — so
// gating the guest button on the answer keeps this page byte-identical in
// behavior everywhere else.
type GuestCredentials = { email: string; password: string };
declare global {
    interface Window {
        mikeDesktop?: {
            guestCredentials?: () => Promise<GuestCredentials | null>;
        };
    }
}

export default function LoginPage() {
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [guest, setGuest] = useState<GuestCredentials | null>(null);

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/assistant");
        }
    }, [authLoading, isAuthenticated, router]);

    useEffect(() => {
        let cancelled = false;
        window.mikeDesktop
            ?.guestCredentials?.()
            .then((creds) => {
                if (!cancelled && creds?.email && creds?.password) {
                    setGuest(creds);
                }
            })
            .catch(() => {});
        return () => {
            cancelled = true;
        };
    }, []);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabase.auth.signInWithPassword({
                email,
                password,
            });

            if (error) throw error;

            router.push("/assistant");
        } catch (error: unknown) {
            setError(
                error instanceof Error
                    ? error.message
                    : "An error occurred during login",
            );
        } finally {
            setLoading(false);
        }
    };

    const handleGuestLogin = async () => {
        if (!guest) return;
        setLoading(true);
        setError(null);

        try {
            const { error } = await supabase.auth.signInWithPassword(guest);
            if (error) {
                // First use: the guest account doesn't exist yet. Local mode
                // autoconfirms signups, so this returns a session directly.
                const { error: signUpError } = await supabase.auth.signUp(guest);
                if (signUpError) throw signUpError;
            }
            router.push("/assistant");
        } catch (error: unknown) {
            setError(
                error instanceof Error
                    ? error.message
                    : "An error occurred during guest login",
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-dvh items-center justify-center bg-gray-50/80 px-6 py-10">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="lg" asLink />
            </div>
            <div className="w-full max-w-md">
                {/* Login Form */}
                <div
                    className={cn(authGlassCardClassName, "mb-4 pb-5")}
                >
                    <h2 className="mb-6 text-left text-2xl font-medium font-serif text-gray-950">
                        Log In
                    </h2>
                    <form onSubmit={handleLogin} className="space-y-4">
                        <div>
                            <label
                                htmlFor="email"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Email
                            </label>
                            <Input
                                id="email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                required
                                className={`w-full ${authInputClassName}`}
                            />
                        </div>

                        <div>
                            <div className="mb-2 flex items-center justify-between gap-3">
                                <label
                                    htmlFor="password"
                                    className="block text-sm font-medium text-gray-700"
                                >
                                    Password
                                </label>
                                <Link
                                    href="/forgot-password"
                                    className="text-xs font-medium text-gray-500 transition-colors hover:text-gray-950"
                                >
                                    Forgot password?
                                </Link>
                            </div>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your password"
                                required
                                className={`w-full ${authInputClassName}`}
                            />
                        </div>

                        {error && (
                            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                                {error}
                            </div>
                        )}

                        <div className="pt-2">
                            <PillButton
                                type="submit"
                                tone="black"
                                size="normal"
                                disabled={loading}
                                className="w-full"
                            >
                                {loading ? "Logging in..." : "Log in"}
                            </PillButton>
                        </div>
                        {guest && (
                            <>
                                <div className="flex items-center gap-3 text-xs text-gray-400">
                                    <div className="h-px flex-1 bg-gray-200" />
                                    or
                                    <div className="h-px flex-1 bg-gray-200" />
                                </div>
                                <PillButton
                                    type="button"
                                    tone="white"
                                    size="normal"
                                    onClick={handleGuestLogin}
                                    disabled={loading}
                                    className="w-full border border-gray-200 text-gray-900"
                                >
                                    Continue as guest
                                </PillButton>
                            </>
                        )}
                        <div className="text-center text-sm text-gray-500">
                            Don&apos;t have an account?{" "}
                            <Link
                                href="/signup"
                                className="font-medium transition-colors hover:text-gray-950"
                            >
                                Sign up
                            </Link>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
}
