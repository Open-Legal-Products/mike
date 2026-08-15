"use client";

import { useEffect, useState } from "react";
import { ApiKeyField } from "@/app/components/settings/ApiKeyField";
import { useUserProfile } from "@/app/contexts/UserProfileContext";
import { listQuickActions, updateQuickAction } from "@/app/lib/mikeApi";
import type { QuickAction } from "@/app/components/shared/types";
import { SettingsSection } from "../SettingsSection";
import { SettingsToggle } from "../SettingsToggle";

export default function FeaturesPage() {
    const { profile, updateApiKey, updateLegalResearchUs } = useUserProfile();
    const [quickActions, setQuickActions] = useState<QuickAction[]>([]);
    const [quickActionsError, setQuickActionsError] = useState<string | null>(
        null,
    );
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [optimisticLegalResearchUs, setOptimisticLegalResearchUs] = useState<
        boolean | null
    >(null);

    const persistedLegalResearchUs = profile?.legalResearchUs ?? true;
    const courtListenerEnabled =
        optimisticLegalResearchUs ?? persistedLegalResearchUs;
    const quickActionsEnabled = quickActions.some((action) => action.enabled);

    useEffect(() => {
        void listQuickActions().then(setQuickActions).catch(() => {});
    }, []);

    const updateAllQuickActions = async (enabled: boolean) => {
        const previous = quickActions;
        setQuickActionsError(null);
        setQuickActions((current) =>
            current.map((action) => ({ ...action, enabled })),
        );
        const results = await Promise.allSettled(
            previous.map((action) => updateQuickAction(action.id, { enabled })),
        );
        setQuickActions(
            previous.map((action, index) => {
                const result = results[index];
                return result.status === "fulfilled" ? result.value : action;
            }),
        );
        const failed = results.filter(
            (result) => result.status === "rejected",
        ).length;
        if (failed > 0) {
            setQuickActionsError(
                failed === results.length
                    ? "Could not update. Try again."
                    : "Some quick actions could not be updated. Try again.",
            );
        }
    };

    const handleCourtListenerChange = async (enabled: boolean) => {
        if (saving) return;
        setSaveError(null);
        setOptimisticLegalResearchUs(enabled);
        setSaving(true);
        const ok = await updateLegalResearchUs(enabled);
        setSaving(false);
        setOptimisticLegalResearchUs(null);
        if (!ok) {
            setSaveError("Could not update. Try again.");
        }
    };

    return (
        <div className="space-y-8">
            <section className="space-y-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-medium font-serif text-gray-900">
                        Assistant
                    </h2>
                </div>
                <SettingsSection>
                    <div className="flex flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-700">
                                Quick actions
                            </p>
                            <p className="text-sm text-gray-500">
                                Show the quick actions row on the assistant
                                start screen.
                            </p>
                            {quickActionsError && (
                                <p className="text-sm text-red-600">
                                    {quickActionsError}
                                </p>
                            )}
                        </div>
                        <SettingsToggle
                            checked={quickActionsEnabled}
                            size="md"
                            onChange={(checked) => {
                                void updateAllQuickActions(checked);
                            }}
                        />
                    </div>
                </SettingsSection>
            </section>

            <section className="space-y-3">
                <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-medium font-serif text-gray-900">
                        Legal Research
                    </h2>
                </div>
                <SettingsSection>
                    <div className="flex items-center justify-between gap-3 px-4 py-5">
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-gray-700">
                                Enable CourtListener
                            </p>
                            <p className="text-sm text-gray-500">
                                CourtListener provides access to US case law.
                            </p>
                        </div>
                        <SettingsToggle
                            checked={courtListenerEnabled}
                            loading={saving}
                            size="md"
                            onChange={(enabled) =>
                                void handleCourtListenerChange(enabled)
                            }
                        />
                    </div>
                    {saveError && (
                        <p className="px-4 pb-4 text-sm text-red-600">
                            {saveError}
                        </p>
                    )}
                    {courtListenerEnabled && (
                        <ApiKeyField
                            label="CourtListener API Key"
                            placeholder="Token..."
                            hasSavedKey={
                                !!profile?.apiKeys.courtlistener.configured
                            }
                            isServerConfigured={
                                profile?.apiKeys.courtlistener.source === "env"
                            }
                            onSave={(value) =>
                                updateApiKey(
                                    "courtlistener",
                                    value.trim() || null,
                                )
                            }
                            onRemove={() =>
                                updateApiKey("courtlistener", null)
                            }
                        />
                    )}
                </SettingsSection>
            </section>
        </div>
    );
}
