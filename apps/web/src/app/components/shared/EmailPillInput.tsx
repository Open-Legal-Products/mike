"use client";

import { useState } from "react";
import { X } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Props {
    emails: string[];
    onChange: (emails: string[]) => void;
    validate?: (email: string) => Promise<string | null>;
    onValidatingChange?: (validating: boolean) => void;
    placeholder?: string;
    autoFocus?: boolean;
}

export function EmailPillInput({
    emails,
    onChange,
    validate,
    onValidatingChange,
    placeholder = "Add by email…",
    autoFocus = false,
}: Props) {
    const [input, setInput] = useState("");
    const [validating, setValidating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    function setValidatingState(v: boolean) {
        setValidating(v);
        onValidatingChange?.(v);
    }

    function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            addEmail();
        } else if (e.key === "Backspace" && !input && emails.length > 0) {
            onChange(emails.slice(0, -1));
        }
    }

    async function addEmail() {
        const email = input.trim().toLowerCase();
        if (!email) return;
        if (emails.includes(email)) {
            setInput("");
            return;
        }
        if (!EMAIL_RE.test(email)) {
            setError("Enter a valid email address.");
            return;
        }
        if (validate) {
            setValidatingState(true);
            setError(null);
            try {
                const err = await validate(email);
                if (err) {
                    setError(err);
                    return;
                }
            } catch {
                setError("Could not verify email. Try again.");
                return;
            } finally {
                setValidatingState(false);
            }
        }
        onChange([...emails, email]);
        setInput("");
        setError(null);
    }

    return (
        <div>
            <div
                className={`flex flex-wrap gap-1.5 rounded-lg border bg-gray-50 px-3 py-2 min-h-[40px] transition-colors ${
                    error
                        ? "border-red-300 focus-within:border-red-400"
                        : "border-gray-200 focus-within:border-gray-400"
                }`}
            >
                {emails.map((email) => (
                    <span
                        key={email}
                        className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2.5 py-0.5 text-xs text-gray-700"
                    >
                        {email}
                        <button
                            type="button"
                            onClick={() => onChange(emails.filter((e) => e !== email))}
                            className="text-gray-400 hover:text-gray-700 transition-colors"
                        >
                            <X className="h-3 w-3" />
                        </button>
                    </span>
                ))}
                <input
                    type="email"
                    value={input}
                    onChange={(e) => {
                        setInput(e.target.value);
                        setError(null);
                    }}
                    onKeyDown={handleKeyDown}
                    onBlur={addEmail}
                    placeholder={emails.length === 0 ? placeholder : ""}
                    className="flex-1 min-w-[160px] bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none"
                    autoFocus={autoFocus}
                />
            </div>
            {error && <p className="mt-1.5 text-xs text-red-500">{error}</p>}
            {validating && <p className="mt-1.5 text-xs text-gray-400">Checking…</p>}
        </div>
    );
}
