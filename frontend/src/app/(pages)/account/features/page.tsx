"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { AccountSection } from "../AccountSection";

export default function FeaturesPage() {
    const { profile, updateLegalResearchUs } = useUserProfile();
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [draftLegalResearchUs, setDraftLegalResearchUs] = useState<
        boolean | null
    >(null);
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        };
    }, []);

    const persistedLegalResearchUs = profile?.legalResearchUs ?? true;
    const usEnabled = draftLegalResearchUs ?? persistedLegalResearchUs;
    const hasChanges =
        draftLegalResearchUs !== null &&
        draftLegalResearchUs !== persistedLegalResearchUs;

    const handleUpdateLegalResearch = async () => {
        if (saving) return;
        setSaved(false);
        setSaveError(null);
        setSaving(true);
        const ok = await updateLegalResearchUs(usEnabled);
        setSaving(false);
        if (ok) {
            setDraftLegalResearchUs(null);
            setSaved(true);
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
            savedTimerRef.current = setTimeout(() => setSaved(false), 1600);
        } else {
            setSaveError("Could not update. Try again.");
        }
    };

    return (
        <div className="space-y-8">
            <section className="space-y-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-medium font-serif text-gray-900">
                        Legal Research
                    </h2>
                </div>
                <AccountSection>
                    <div className="px-4 py-5">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-900">
                                Jurisdiction
                            </p>
                            <p className="text-sm text-gray-500">
                                Choose which jurisdictions the assistant can
                                research. When a jurisdiction is enabled, its
                                case-law research tools are available in chat.
                            </p>
                        </div>
                        <div className="mt-4 flex items-start justify-between gap-3 px-3 bg-gray-50 py-3 rounded-md">
                            <label
                                htmlFor="jurisdiction-us"
                                className="min-w-0 cursor-pointer select-none"
                            >
                                <p className="text-sm text-gray-900">US</p>
                                <p className="text-sm text-gray-500">
                                    Enable US case law research (CourtListener)
                                    in chat.
                                </p>
                            </label>
                            <button
                                id="jurisdiction-us"
                                type="button"
                                role="checkbox"
                                aria-checked={usEnabled}
                                onClick={() => {
                                    setDraftLegalResearchUs(!usEnabled);
                                    setSaved(false);
                                    setSaveError(null);
                                }}
                                disabled={saving}
                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                                    usEnabled
                                        ? "border-gray-950 bg-gray-950 text-white"
                                        : "border-gray-300 bg-white text-transparent"
                                } disabled:cursor-not-allowed disabled:opacity-45`}
                            >
                                <Check className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        <div className="mt-5 flex items-center justify-between gap-3">
                            <p className="text-sm text-red-600">
                                {saveError ?? ""}
                            </p>
                            <button
                                type="button"
                                onClick={() => void handleUpdateLegalResearch()}
                                disabled={saving || !hasChanges}
                                className="text-sm font-medium text-gray-700 transition-colors hover:text-gray-950 disabled:cursor-not-allowed disabled:text-gray-300"
                            >
                                {saving
                                    ? "Updating..."
                                    : saved
                                      ? "Updated"
                                      : "Update"}
                            </button>
                        </div>
                    </div>
                </AccountSection>
            </section>
        </div>
    );
}
