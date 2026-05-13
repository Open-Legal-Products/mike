"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
    const { isAuthenticated, authLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/assistant");
        }
    }, [isAuthenticated, authLoading, router]);

    const handleLogin = async () => {
        const redirectTo = `${window.location.origin}/auth/callback`;
        await supabase.auth.signInWithOAuth({
            provider: "azure",
            options: { redirectTo, scopes: "email" },
        });
    };

    if (authLoading) {
        return (
            <div className="h-dvh flex items-center justify-center bg-[#292629]">
                <div className="w-5 h-5 border-2 border-white/20 border-t-white rounded-full animate-spin" />
            </div>
        );
    }

    return (
        <div className="h-dvh flex items-center justify-center bg-[#292629]">
            <div className="w-full max-w-sm px-6">
                <div className="mb-10 text-center">
                    <span className="text-white text-2xl tracking-widest uppercase">
                        <span className="font-light">CARBON</span>
                        <span className="font-bold">LEO</span>
                    </span>
                    <p className="text-white/40 text-sm mt-1 tracking-wide">Mike Legal</p>
                </div>

                <button
                    onClick={handleLogin}
                    className="w-full h-10 flex items-center justify-center gap-2.5 rounded-md border border-white/12 bg-white/5 text-sm text-white/80 hover:bg-white/10 hover:text-white transition-colors"
                >
                    <svg className="w-4 h-4 shrink-0" viewBox="0 0 23 23" fill="none">
                        <path d="M1 1h10v10H1z" fill="#F35325" />
                        <path d="M12 1h10v10H12z" fill="#81BC06" />
                        <path d="M1 12h10v10H1z" fill="#05A6F0" />
                        <path d="M12 12h10v10H12z" fill="#FFBA08" />
                    </svg>
                    Sign in with Microsoft
                </button>
            </div>
        </div>
    );
}
