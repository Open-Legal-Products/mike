"use client";

import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Loader2, UserPlus } from "lucide-react";
import {
    lookupUserByEmail,
    type UserLookupResult,
} from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface AddUserInputProps {
    onAdd: (user: UserLookupResult) => Promise<void> | void;
    validateEmail?: (email: string) => Promise<string | null> | string | null;
    busy?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    submitLabel?: string;
    className?: string;
}

export function AddUserInput({
    onAdd,
    validateEmail,
    busy = false,
    placeholder = "Add by email...",
    autoFocus = false,
    submitLabel = "Add user",
    className,
}: AddUserInputProps) {
    const [input, setInput] = useState("");
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const trimmedEmail = input.trim().toLowerCase();
    const showAddButton = trimmedEmail.length > 0;

    async function commitUser() {
        const email = trimmedEmail;
        if (!email || busy || checking) return;
        if (!EMAIL_RE.test(email)) {
            setError("Enter a valid email.");
            return;
        }

        setError(null);
        setChecking(true);
        try {
            const validationError = await validateEmail?.(email);
            if (validationError) {
                setError(validationError);
                return;
            }

            const user = await lookupUserByEmail(email);
            if (!user.exists) {
                setError(`${email} does not belong to a Mike user.`);
                return;
            }

            await onAdd(user);
            setInput("");
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : "Could not add this user. Try again.",
            );
        } finally {
            setChecking(false);
        }
    }

    function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
        if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            void commitUser();
        }
    }

    return (
        <div>
            <div
                className={cn(
                    "flex min-h-10 items-center gap-2 rounded-xl border border-white/70 bg-white/55 px-3 py-1.5 shadow-[0_3px_9px_rgba(15,23,42,0.04),inset_0_1px_0_rgba(255,255,255,0.86),inset_0_-1px_0_rgba(255,255,255,0.58)] backdrop-blur-xl transition-colors focus-within:bg-white/70",
                    className,
                )}
            >
                <UserPlus className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                <input
                    type="email"
                    value={input}
                    onChange={(event) => {
                        setInput(event.target.value);
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    className="min-w-0 flex-1 bg-transparent text-sm text-gray-700 outline-none placeholder:text-gray-400"
                    autoFocus={autoFocus}
                />
                {showAddButton && (
                    <button
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => void commitUser()}
                        disabled={busy || checking}
                        title={submitLabel}
                        className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full border border-blue-500/35 bg-blue-600/90 px-2.5 text-[11px] font-medium leading-none text-white shadow-[0_3px_9px_rgba(37,99,235,0.10),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-1px_0_rgba(255,255,255,0.16),inset_0_-4px_9px_rgba(29,78,216,0.2)] backdrop-blur-xl transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {(busy || checking) && (
                            <Loader2 className="h-3 w-3 animate-spin" />
                        )}
                        Add
                    </button>
                )}
            </div>
            {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
        </div>
    );
}
