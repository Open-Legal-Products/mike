"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/auth/cognito";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { SiteLogo } from "@/components/site-logo";
import { CheckCircle2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { updateUserProfile } from "@/app/lib/mikeApi";

type Step = "form" | "confirm" | "success";

export default function SignupPage() {
    const router = useRouter();
    const { isAuthenticated, authLoading } = useAuth();
    const [step, setStep] = useState<Step>("form");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [name, setName] = useState("");
    const [organisation, setOrganisation] = useState("");
    const [code, setCode] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!authLoading && isAuthenticated && step === "form") {
            router.replace("/assistant");
        }
    }, [authLoading, isAuthenticated, router, step]);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        if (password !== confirmPassword) {
            setError("Passwords do not match");
            setLoading(false);
            return;
        }
        if (password.length < 6) {
            setError("Password must be at least 6 characters");
            setLoading(false);
            return;
        }

        const { error: signUpError } = await supabase.auth.signUp({
            email,
            password,
        });
        setLoading(false);
        if (signUpError) {
            setError(signUpError.message);
            return;
        }
        setStep("confirm");
    };

    const handleConfirm = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const { error: confirmError } = await supabase.auth.confirmSignUp({
            email,
            code: code.trim(),
        });
        if (confirmError) {
            setError(confirmError.message);
            setLoading(false);
            return;
        }

        const { data: signInData, error: signInError } =
            await supabase.auth.signInWithPassword({ email, password });
        if (signInError || !signInData.session) {
            setError(
                signInError?.message ??
                    "Confirmed, but could not sign in automatically. Please log in.",
            );
            setLoading(false);
            return;
        }

        const trimmedName = name.trim();
        const trimmedOrg = organisation.trim();
        if (trimmedName || trimmedOrg) {
            try {
                await updateUserProfile({
                    ...(trimmedName && { displayName: trimmedName }),
                    ...(trimmedOrg && { organisation: trimmedOrg }),
                });
            } catch (profileError) {
                console.error(
                    "[signup] failed to persist profile fields",
                    profileError,
                );
            }
        }

        setStep("success");
        setTimeout(() => router.push("/assistant"), 2000);
    };

    const handleResend = async () => {
        setError(null);
        const { error: resendError } =
            await supabase.auth.resendConfirmationCode({ email });
        if (resendError) setError(resendError.message);
    };

    if (step === "success") {
        return (
            <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
                <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                    <SiteLogo size="md" className="md:text-4xl" asLink />
                </div>
                <div className="w-full max-w-md">
                    <div className="bg-white border border-gray-200 rounded-2xl p-10 text-center shadow-sm">
                        <div className="mx-auto w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 className="h-6 w-6 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-semibold text-gray-900 mb-3">
                            Account created!
                        </h2>
                        <p className="text-gray-600 leading-relaxed">
                            Redirecting you to the home page...
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    if (step === "confirm") {
        return (
            <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
                <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                    <SiteLogo size="md" className="md:text-4xl" asLink />
                </div>
                <div className="w-full max-w-md">
                    <div className="bg-white border border-gray-200 rounded-2xl p-8 mb-4">
                        <h2 className="text-left text-2xl font-serif mb-2">
                            Confirm your email
                        </h2>
                        <p className="text-sm text-gray-600 mb-6">
                            We sent a confirmation code to{" "}
                            <span className="font-medium">{email}</span>.
                        </p>
                        <form onSubmit={handleConfirm} className="space-y-4">
                            <div>
                                <label
                                    htmlFor="code"
                                    className="block text-sm font-medium text-gray-700 mb-2"
                                >
                                    Confirmation code
                                </label>
                                <Input
                                    id="code"
                                    type="text"
                                    inputMode="numeric"
                                    autoComplete="one-time-code"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value)}
                                    placeholder="6-digit code"
                                    required
                                    className="w-full"
                                />
                            </div>
                            {error && (
                                <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                                    {error}
                                </div>
                            )}
                            <Button
                                type="submit"
                                disabled={loading}
                                className="w-full bg-black hover:bg-gray-900 text-white"
                            >
                                {loading ? "Confirming..." : "Confirm"}
                            </Button>
                        </form>
                        <button
                            type="button"
                            onClick={handleResend}
                            className="mt-4 text-sm text-blue-600 hover:underline"
                        >
                            Resend code
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-dvh bg-white flex items-start justify-center px-6 pt-32 md:pt-40 pb-10 relative">
            <div className="absolute top-4 md:top-8 left-1/2 -translate-x-1/2">
                <SiteLogo size="md" className="md:text-4xl" asLink />
            </div>
            <div className="w-full max-w-md">
                <div className="bg-white border border-gray-200 rounded-2xl p-8 mb-4">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-left text-2xl font-serif">
                            Create Account
                        </h2>
                        <div className="bg-gray-100 p-1 rounded-md flex text-xs font-medium">
                            <Link
                                href="/login"
                                className="px-3 py-1 text-gray-500 hover:text-gray-900"
                            >
                                Log in
                            </Link>
                            <span className="px-3 py-1 bg-white rounded-sm shadow-sm text-gray-900">
                                Sign up
                            </span>
                        </div>
                    </div>

                    <form onSubmit={handleSignup} className="space-y-4">
                        <div>
                            <label
                                htmlFor="name"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Name{" "}
                                <span className="text-gray-400 font-normal">
                                    (optional)
                                </span>
                            </label>
                            <Input
                                id="name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Your name"
                                className="w-full"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="organisation"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Organisation{" "}
                                <span className="text-gray-400 font-normal">
                                    (optional)
                                </span>
                            </label>
                            <Input
                                id="organisation"
                                type="text"
                                value={organisation}
                                onChange={(e) =>
                                    setOrganisation(e.target.value)
                                }
                                placeholder="Your organisation"
                                className="w-full"
                            />
                        </div>

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
                                placeholder="Enter your email"
                                required
                                className="w-full"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="password"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Password
                            </label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Create a password (min. 6 characters)"
                                required
                                className="w-full"
                            />
                        </div>

                        <div>
                            <label
                                htmlFor="confirmPassword"
                                className="block text-sm font-medium text-gray-700 mb-2"
                            >
                                Confirm Password
                            </label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) =>
                                    setConfirmPassword(e.target.value)
                                }
                                placeholder="Confirm your password"
                                required
                                className="w-full"
                            />
                        </div>

                        {error && (
                            <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                                {error}
                            </div>
                        )}

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full bg-black hover:bg-gray-900 text-white"
                        >
                            {loading ? "Creating account..." : "Sign up"}
                        </Button>
                    </form>

                    <div className="mt-4 text-center text-xs text-gray-500">
                        By signing up, you agree to our{" "}
                        <Link
                            href="https://mikeoss.com/terms"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            Terms of Use
                        </Link>{" "}
                        and{" "}
                        <Link
                            href="https://mikeoss.com/privacy"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:underline"
                        >
                            Privacy Policy
                        </Link>
                    </div>
                </div>
                <p className="text-center text-xs text-gray-500 leading-relaxed px-2">
                    Mike hosted on MikeOSS.com is currently a demo service.
                    Please do not upload, submit, or store sensitive,
                    confidential, privileged, client, or personally identifiable
                    documents.
                </p>
            </div>
        </div>
    );
}
