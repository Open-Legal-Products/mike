"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check } from "lucide-react";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import type { LegalResearchSettings } from "@/app/lib/mikeApi";
import { AccountSection } from "../AccountSection";

const JURISDICTIONS = [
    {
        id: "CA-ON" as const,
        label: "Ontario, Canada",
        description:
            "Ontario decisions, e-Laws, rules and applicable federal law.",
    },
    {
        id: "CA" as const,
        label: "Federal — Canada",
        description: "Supreme Court, Federal Courts and Justice Laws sources.",
    },
    {
        id: "US" as const,
        label: "United States",
        description: "Preserved Mike case-law research through CourtListener.",
    },
];

export default function FeaturesPage() {
    const { profile, updateLegalResearch } = useUserProfile();
    const [draft, setDraft] = useState<LegalResearchSettings | null>(null);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        };
    }, []);

    const persisted = profile?.legalResearch ?? null;
    const settings = draft ?? persisted;
    const hasChanges = useMemo(
        () => !!draft && JSON.stringify(draft) !== JSON.stringify(persisted),
        [draft, persisted],
    );

    const updateDraft = (next: LegalResearchSettings) => {
        setDraft(next);
        setSaved(false);
        setSaveError(null);
    };

    const toggleJurisdiction = (
        jurisdiction: LegalResearchSettings["enabledJurisdictions"][number],
    ) => {
        if (!settings) return;
        const enabled = settings.enabledJurisdictions.includes(jurisdiction);
        const enabledJurisdictions = enabled
            ? settings.enabledJurisdictions.filter(
                  (item) => item !== jurisdiction,
              )
            : [...settings.enabledJurisdictions, jurisdiction];
        const provider = jurisdiction === "US" ? "courtlistener-us" : null;
        const enabledSourceProviders = provider
            ? enabled
                ? settings.enabledSourceProviders.filter(
                      (item) => item !== provider,
                  )
                : [...new Set([...settings.enabledSourceProviders, provider])]
            : settings.enabledSourceProviders;
        updateDraft({
            ...settings,
            enabledJurisdictions,
            enabledSourceProviders,
        });
    };

    const handleSave = async () => {
        if (!settings || saving || !hasChanges) return;
        setSaving(true);
        setSaveError(null);
        const ok = await updateLegalResearch(settings);
        setSaving(false);
        if (!ok) {
            setSaveError("Could not update. Try again.");
            return;
        }
        setDraft(null);
        setSaved(true);
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => setSaved(false), 1600);
    };

    return (
        <div className="space-y-8">
            <section className="space-y-3">
                <h2 className="font-serif text-2xl font-medium text-gray-900">
                    Legal research
                </h2>
                <AccountSection>
                    <div className="space-y-5 px-4 py-5">
                        <div>
                            <p className="text-sm font-medium text-gray-900">
                                Default jurisdiction
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                ROSS starts with Ontario and applicable federal
                                Canadian law. It asks when the governing
                                jurisdiction is unclear.
                            </p>
                            <div
                                className="mt-3 flex flex-wrap gap-2"
                                role="radiogroup"
                                aria-label="Default legal jurisdiction"
                            >
                                {(["CA", "US"] as const).map((country) => (
                                    <button
                                        key={country}
                                        type="button"
                                        role="radio"
                                        aria-checked={
                                            settings?.defaultCountry === country
                                        }
                                        disabled={!settings || saving}
                                        onClick={() =>
                                            settings &&
                                            updateDraft({
                                                ...settings,
                                                defaultCountry: country,
                                                defaultProvince:
                                                    country === "CA"
                                                        ? "ON"
                                                        : null,
                                            })
                                        }
                                        className={`rounded-md border px-3 py-2 text-sm ${
                                            settings?.defaultCountry === country
                                                ? "border-gray-950 bg-gray-950 text-white"
                                                : "border-gray-300 bg-white text-gray-700"
                                        } disabled:opacity-45`}
                                    >
                                        {country === "CA"
                                            ? "Ontario, Canada"
                                            : "United States"}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div>
                            <p className="text-sm font-medium text-gray-900">
                                Enabled jurisdictions
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                Enabling a jurisdiction makes only its
                                configured legal-source providers available.
                                Coverage limitations are still shown in results.
                            </p>
                            <div className="mt-3 space-y-2">
                                {JURISDICTIONS.map((item) => {
                                    const checked =
                                        settings?.enabledJurisdictions.includes(
                                            item.id,
                                        ) ?? false;
                                    return (
                                        <div
                                            key={item.id}
                                            className="flex items-start justify-between gap-3 rounded-md bg-gray-50 px-3 py-3"
                                        >
                                            <label
                                                htmlFor={`jurisdiction-${item.id}`}
                                                className="min-w-0 cursor-pointer select-none"
                                            >
                                                <span className="block text-sm text-gray-900">
                                                    {item.label}
                                                </span>
                                                <span className="block text-sm text-gray-500">
                                                    {item.description}
                                                </span>
                                            </label>
                                            <button
                                                id={`jurisdiction-${item.id}`}
                                                type="button"
                                                role="checkbox"
                                                aria-checked={checked}
                                                onClick={() =>
                                                    toggleJurisdiction(item.id)
                                                }
                                                disabled={!settings || saving}
                                                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-sm border transition-colors ${
                                                    checked
                                                        ? "border-gray-950 bg-gray-950 text-white"
                                                        : "border-gray-300 bg-white text-transparent"
                                                } disabled:cursor-not-allowed disabled:opacity-45`}
                                            >
                                                <Check className="h-3.5 w-3.5" />
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <p className="text-sm text-red-600">
                                {saveError ?? ""}
                            </p>
                            <button
                                type="button"
                                onClick={() => void handleSave()}
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
