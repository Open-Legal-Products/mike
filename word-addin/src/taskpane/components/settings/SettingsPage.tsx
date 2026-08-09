import React from "react";
import { LogOut } from "lucide-react";
import { ToggleSwitch } from "../../../shared/ui/toggle-switch";
import { PageTitle } from "../primitives/PageTitle";
import { PillButton } from "../primitives/PillButton";
import type { WordChatStorageMode } from "../../lib/wordChatSettings";

interface SettingsPageProps {
  storageMode: WordChatStorageMode;
  onStorageModeChange: (mode: WordChatStorageMode) => Promise<void>;
  onSignOut: () => void;
}

export function SettingsPage({
  storageMode,
  onStorageModeChange,
  onSignOut,
}: SettingsPageProps): React.ReactElement {
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const updateMode = async (cloud: boolean): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await onStorageModeChange(cloud ? "cloud" : "local");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save the chat storage setting."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto p-4">
      <PageTitle className="mb-5 px-1">Settings</PageTitle>
      <section className="rounded-xl border border-white/70 bg-white/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-gray-900">Save chats in the cloud</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Cloud chats are linked to this Word document and available on your other devices.
            </p>
          </div>
          <ToggleSwitch
            aria-label="Save chats in the cloud"
            checked={storageMode === "cloud"}
            disabled={saving}
            onCheckedChange={(checked) => void updateMode(checked)}
          />
        </div>

        {error && (
          <p role="alert" className="mt-3 text-xs text-red-600">
            {error}
          </p>
        )}
      </section>

      <section className="mt-3 rounded-xl border border-white/70 bg-white/70 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_8px_24px_rgba(15,23,42,0.06)]">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-gray-900">Account</h2>
            <p className="mt-1 text-xs leading-5 text-gray-500">
              Signing out clears this device&rsquo;s session. Cloud chats stay
              in your account.
            </p>
          </div>
          <PillButton tone="black" onClick={onSignOut} className="shrink-0">
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </PillButton>
        </div>
      </section>
    </div>
  );
}
