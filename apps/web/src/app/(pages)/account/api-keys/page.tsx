"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/app/components/ui/input";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import {
    MfaVerificationPopup,
    needsMfaVerification,
} from "@/app/components/popups/MfaVerificationPopup";
import { isMfaRequiredError } from "@/app/lib/mikeApi";
import {
    accountGlassIconButtonClassName,
    accountGlassInputClassName,
} from "../accountStyles";
import { AccountSection } from "../AccountSection";

const MODEL_API_KEY_FIELDS = [
    {
        provider: "claude",
        label: "Anthropic (Claude) API Key",
        placeholder: "sk-ant-...",
    },
    {
        provider: "gemini",
        label: "Google (Gemini) API Key",
        placeholder: "AI...",
    },
    {
        provider: "openai",
        label: "OpenAI API Key",
        placeholder: "sk-...",
    },
    {
        provider: "openrouter",
        label: "OpenRouter API Key",
        placeholder: "sk-or-...",
    },
] as const;

const OTHER_API_KEY_FIELDS = [
    {
        provider: "courtlistener",
        label: "CourtListener API Key",
        placeholder: "Token...",
        description:
            "Add a CourtListener API key if you want the latest CourtListener data. Otherwise, Mike will use the bulk data hosted by us.",
    },
] as const;

export default function ApiKeysPage() {
    const { profile, updateApiKey } = useUserProfile();

    return (
        <div>
            <h2 className="mb-3 text-2xl font-medium font-serif text-gray-900">
                API Keys
            </h2>
            <p className="text-sm text-gray-500 mb-4">
                You must provide your own API keys for the app to work or add
                your API keys into the .env file if you are running your own
                instance of Mike. All API keys are encrypted in storage.
            </p>
            <AccountSection>
                {MODEL_API_KEY_FIELDS.map((field, index) => (
                    <div key={field.provider}>
                        <ApiKeyField
                            label={field.label}
                            placeholder={field.placeholder}
                            hasSavedKey={
                                !!profile?.apiKeys[field.provider].configured
                            }
                            isServerConfigured={
                                profile?.apiKeys[field.provider].source ===
                                "env"
                            }
                            onSave={(value) =>
                                updateApiKey(
                                    field.provider,
                                    value.trim() || null,
                                )
                            }
                            onRemove={() => updateApiKey(field.provider, null)}
                        />
                        {index < MODEL_API_KEY_FIELDS.length - 1 && (
                            <div className="mx-4 h-px bg-gray-200" />
                        )}
                    </div>
                ))}
            </AccountSection>

            <AccountSection className="mt-8">
                {OTHER_API_KEY_FIELDS.map((field) => (
                    <ApiKeyField
                        key={field.provider}
                        label={field.label}
                        description={field.description}
                        placeholder={field.placeholder}
                        hasSavedKey={
                            !!profile?.apiKeys[field.provider].configured
                        }
                        isServerConfigured={
                            profile?.apiKeys[field.provider].source === "env"
                        }
                        onSave={(value) =>
                            updateApiKey(field.provider, value.trim() || null)
                        }
                        onRemove={() => updateApiKey(field.provider, null)}
                    />
                ))}
            </AccountSection>
        </div>
    );
}

function ApiKeyField({
    label,
    description,
    placeholder,
    hasSavedKey,
    isServerConfigured,
    onSave,
    onRemove,
}: {
    label: string;
    description?: string;
    placeholder: string;
    hasSavedKey: boolean;
    isServerConfigured: boolean;
    onSave: (value: string) => Promise<boolean>;
    onRemove: () => Promise<boolean>;
}) {
    const [value, setValue] = useState("");
    const [reveal, setReveal] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [pendingMfaAction, setPendingMfaAction] = useState<
        "save" | "remove" | null
    >(null);

    useEffect(() => {
        setValue("");
    }, [hasSavedKey]);

    const dirty = value.trim().length > 0;

    const handleSave = async () => {
        setIsSaving(true);
        try {
            if (await needsMfaVerification()) {
                setPendingMfaAction("save");
                return;
            }
            const ok = await onSave(value);
            if (ok) {
                setValue("");
                setSaved(true);
                setTimeout(() => setSaved(false), 2000);
            } else {
                alert(`Failed to save ${label}.`);
            }
        } catch (error) {
            if (isMfaRequiredError(error)) {
                setPendingMfaAction("save");
            } else {
                alert(`Failed to save ${label}.`);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleRemove = async () => {
        setIsSaving(true);
        try {
            if (await needsMfaVerification()) {
                setPendingMfaAction("remove");
                return;
            }
            const ok = await onRemove();
            if (!ok) alert(`Failed to remove ${label}.`);
        } catch (error) {
            if (isMfaRequiredError(error)) {
                setPendingMfaAction("remove");
            } else {
                alert(`Failed to remove ${label}.`);
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleMfaVerified = async () => {
        const action = pendingMfaAction;
        setPendingMfaAction(null);
        if (action === "save") {
            await handleSave();
        } else if (action === "remove") {
            await handleRemove();
        }
    };

    return (
        <>
            <div className="px-4 py-5">
                <label className="text-sm font-medium text-gray-700 block mb-2">
                    {label}
                </label>
                {description && (
                    <p className="text-sm text-gray-500 mb-3">{description}</p>
                )}
                <div className="space-y-2">
                    <div className="relative flex-1">
                        <Input
                            type={reveal ? "text" : "password"}
                            value={value}
                            onChange={(e) => setValue(e.target.value)}
                            placeholder={
                                isServerConfigured
                                    ? "Server .env key configured"
                                    : hasSavedKey
                                      ? "Saved key hidden"
                                      : placeholder
                            }
                            className={`pr-10 ${accountGlassInputClassName}`}
                            autoComplete="off"
                            spellCheck={false}
                            disabled={isServerConfigured}
                        />
                        {dirty && (
                            <button
                                type="button"
                                onClick={() => setReveal((r) => !r)}
                                disabled={isServerConfigured}
                                className={`absolute inset-y-1 right-1.5 flex items-center ${accountGlassIconButtonClassName}`}
                                aria-label={reveal ? "Hide key" : "Show key"}
                            >
                                {reveal ? (
                                    <EyeOff className="h-4 w-4" />
                                ) : (
                                    <Eye className="h-4 w-4" />
                                )}
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            disabled={
                                isServerConfigured ||
                                isSaving ||
                                !dirty ||
                                saved
                            }
                            className="text-xs font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-400"
                        >
                            {isSaving ? (
                                "Saving..."
                            ) : saved ? (
                                "Saved"
                            ) : (
                                "Save"
                            )}
                        </button>
                        {hasSavedKey && !isServerConfigured && (
                            <button
                                type="button"
                                onClick={handleRemove}
                                disabled={isSaving}
                                className="text-xs font-medium text-red-600 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:text-red-300"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                </div>
            </div>
            <MfaVerificationPopup
                open={!!pendingMfaAction}
                onCancel={() => setPendingMfaAction(null)}
                onVerified={() => void handleMfaVerified()}
            />
        </>
    );
}
