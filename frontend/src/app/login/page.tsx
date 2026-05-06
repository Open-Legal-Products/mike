"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/contexts/AuthContext";

export default function LoginPage() {
    const { isAuthenticated, authLoading } = useAuth();
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!authLoading && isAuthenticated) {
            router.replace("/assistant");
        }
    }, [isAuthenticated, authLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
            setError("Email ou mot de passe incorrect.");
            setLoading(false);
        }
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
                {/* Logo */}
                <div className="mb-10 text-center">
                    <span className="text-white text-2xl tracking-widest uppercase">
                        <span className="font-light">CARBON</span><span className="font-bold">LEO</span>
                    </span>
                    <p className="text-white/40 text-sm mt-1 tracking-wide">Mike Legal</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wider">
                            Email
                        </label>
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            required
                            autoComplete="email"
                            className="w-full h-10 rounded-md bg-white/8 border border-white/12 px-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#FEEA0F]/60 focus:ring-1 focus:ring-[#FEEA0F]/30 transition-colors"
                            placeholder="vous@carbonleo.com"
                        />
                    </div>

                    <div>
                        <label className="block text-xs text-white/50 mb-1.5 uppercase tracking-wider">
                            Mot de passe
                        </label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            autoComplete="current-password"
                            className="w-full h-10 rounded-md bg-white/8 border border-white/12 px-3 text-sm text-white placeholder-white/25 focus:outline-none focus:border-[#FEEA0F]/60 focus:ring-1 focus:ring-[#FEEA0F]/30 transition-colors"
                            placeholder="••••••••"
                        />
                    </div>

                    {error && (
                        <p className="text-red-400 text-sm">{error}</p>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full h-10 rounded-md bg-[#FEEA0F] text-[#292629] text-sm font-semibold hover:bg-[#FEEA0F]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
                    >
                        {loading ? "Connexion…" : "Se connecter"}
                    </button>
                </form>
            </div>
        </div>
    );
}
