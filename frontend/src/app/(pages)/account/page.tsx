"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LogOut, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { deleteAccount } from "@/app/lib/mikeApi";
import { PRACTICE_AREAS } from "@/app/lib/practiceAreas";

export default function AccountPage() {
    const router = useRouter();
    const { user, signOut } = useAuth();
    const {
        profile,
        updateDisplayName,
        updateOrganisation,
        updatePracticeProfile,
        updatePracticeProfiles,
    } = useUserProfile();
    const [displayName, setDisplayName] = useState("");
    const [isSavingName, setIsSavingName] = useState(false);
    const [saved, setSaved] = useState(false);
    const [organisation, setOrganisation] = useState("");
    const [isSavingOrg, setIsSavingOrg] = useState(false);
    const [orgSaved, setOrgSaved] = useState(false);
    const [practiceProfile, setPracticeProfile] = useState("");
    const [isSavingPractice, setIsSavingPractice] = useState(false);
    const [practiceSaved, setPracticeSaved] = useState(false);
    const [areaProfiles, setAreaProfiles] = useState<Record<string, string>>(
        {},
    );
    const [isSavingAreas, setIsSavingAreas] = useState(false);
    const [areasSaved, setAreasSaved] = useState(false);
    const [deleteConfirm, setDeleteConfirm] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    useEffect(() => {
        if (profile?.displayName) {
            setDisplayName(profile.displayName);
        }
        if (profile?.organisation) {
            setOrganisation(profile.organisation);
        }
        setPracticeProfile(profile?.practiceProfile ?? "");
        setAreaProfiles(profile?.practiceProfiles ?? {});
    }, [profile]);

    const handleLogout = async () => {
        await signOut();
        router.push("/");
    };

    const handleDeleteAccount = async () => {
        setIsDeleting(true);
        try {
            await deleteAccount();
            await signOut();
            router.push("/");
        } catch {
            setIsDeleting(false);
            setDeleteConfirm(false);
            alert("Failed to delete account. Please try again.");
        }
    };

    const handleSaveDisplayName = async () => {
        setIsSavingName(true);
        const success = await updateDisplayName(displayName.trim());
        setIsSavingName(false);

        if (success) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } else {
            alert("Failed to update display name. Please try again.");
        }
    };

    const handleSaveOrganisation = async () => {
        setIsSavingOrg(true);
        const success = await updateOrganisation(organisation.trim());
        setIsSavingOrg(false);

        if (success) {
            setOrgSaved(true);
            setTimeout(() => setOrgSaved(false), 2000);
        } else {
            alert("Failed to update organisation. Please try again.");
        }
    };

    const handleSavePracticeProfile = async () => {
        setIsSavingPractice(true);
        const success = await updatePracticeProfile(practiceProfile);
        setIsSavingPractice(false);

        if (success) {
            setPracticeSaved(true);
            setTimeout(() => setPracticeSaved(false), 2000);
        } else {
            alert("Failed to update practice profile. Please try again.");
        }
    };

    const handleSaveAreaProfiles = async () => {
        setIsSavingAreas(true);
        const success = await updatePracticeProfiles(areaProfiles);
        setIsSavingAreas(false);

        if (success) {
            setAreasSaved(true);
            setTimeout(() => setAreasSaved(false), 2000);
        } else {
            alert("Failed to update area profiles. Please try again.");
        }
    };

    const areasDirty = PRACTICE_AREAS.some(
        (area) =>
            (areaProfiles[area] ?? "").trim() !==
            (profile?.practiceProfiles?.[area] ?? "").trim(),
    );

    if (!user) return null;

    return (
        <div className="space-y-4">
            {/* Profile Settings */}
            <div className="pb-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">Profile</h2>
                </div>
                <div className="space-y-4">
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            Display Name
                        </label>
                        <div className="flex gap-2">
                            <Input
                                type="text"
                                value={displayName}
                                onChange={(e) => setDisplayName(e.target.value)}
                                placeholder="Enter your name"
                                className="flex-1"
                            />
                            <Button
                                onClick={handleSaveDisplayName}
                                disabled={
                                    isSavingName || !displayName.trim() || saved
                                }
                                className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                            >
                                {isSavingName ? (
                                    "Saving..."
                                ) : saved ? (
                                    <>
                                        <Check className="h-4 w-3" />
                                        Saved
                                    </>
                                ) : (
                                    "Save"
                                )}
                            </Button>
                        </div>
                    </div>
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            Organisation
                        </label>
                        <div className="flex gap-2">
                            <Input
                                type="text"
                                value={organisation}
                                onChange={(e) =>
                                    setOrganisation(e.target.value)
                                }
                                placeholder="Enter your organisation"
                                className="flex-1"
                            />
                            <Button
                                onClick={handleSaveOrganisation}
                                disabled={
                                    isSavingOrg ||
                                    organisation.trim() ===
                                        (profile?.organisation ?? "") ||
                                    orgSaved
                                }
                                className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                            >
                                {isSavingOrg ? (
                                    "Saving..."
                                ) : orgSaved ? (
                                    <>
                                        <Check className="h-4 w-3" />
                                        Saved
                                    </>
                                ) : (
                                    "Save"
                                )}
                            </Button>
                        </div>
                    </div>
                    <div>
                        <label className="text-sm text-gray-600 block mb-2">
                            Email
                        </label>
                        <p className="text-base">{user?.email}</p>
                    </div>
                </div>
            </div>

            {/* Practice Profile */}
            <div className="py-6">
                <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-2xl font-medium font-serif">
                        Practice Profile
                    </h2>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    A plain-English playbook the assistant reads on every chat:
                    your firm&apos;s positions, house style, escalation rules,
                    preferred governing law, and review preferences. Workflows
                    use these instead of assuming defaults; anything you leave
                    out, the assistant will ask about.
                </p>
                <textarea
                    value={practiceProfile}
                    onChange={(e) => setPracticeProfile(e.target.value)}
                    placeholder={
                        "e.g. We act sales-side. Liability cap: 12 months' fees; never accept uncapped indemnities — escalate to the GC.\nPreferred governing law: England & Wales. House style: surgical redlines, no wholesale rewrites."
                    }
                    rows={10}
                    maxLength={20000}
                    className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                />
                <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-gray-400">
                        {practiceProfile.length.toLocaleString()} / 20,000
                    </span>
                    <Button
                        onClick={handleSavePracticeProfile}
                        disabled={
                            isSavingPractice ||
                            practiceProfile.trim() ===
                                (profile?.practiceProfile ?? "").trim() ||
                            practiceSaved
                        }
                        className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                    >
                        {isSavingPractice ? (
                            "Saving..."
                        ) : practiceSaved ? (
                            <>
                                <Check className="h-4 w-3" />
                                Saved
                            </>
                        ) : (
                            "Save"
                        )}
                    </Button>
                </div>
            </div>

            {/* Per-practice-area profiles */}
            <div className="py-6">
                <div className="flex items-center gap-2 mb-1">
                    <h2 className="text-2xl font-medium font-serif">
                        Practice-Area Profiles
                    </h2>
                </div>
                <p className="text-sm text-gray-500 mb-4">
                    Optional playbooks scoped to a practice area. The matching
                    profile is added on top of your general profile whenever you
                    run a workflow in that area (e.g. an NDA review applies your
                    Commercial Contracts profile).
                </p>
                <div className="space-y-2">
                    {PRACTICE_AREAS.map((area) => {
                        const filled = (areaProfiles[area] ?? "").trim().length > 0;
                        return (
                            <details
                                key={area}
                                className="rounded-md border border-gray-200 bg-white"
                            >
                                <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium flex items-center justify-between">
                                    <span>{area}</span>
                                    {filled && (
                                        <span className="text-xs text-gray-400">
                                            configured
                                        </span>
                                    )}
                                </summary>
                                <div className="px-3 pb-3">
                                    <textarea
                                        value={areaProfiles[area] ?? ""}
                                        onChange={(e) =>
                                            setAreaProfiles((prev) => ({
                                                ...prev,
                                                [area]: e.target.value,
                                            }))
                                        }
                                        placeholder={`Playbook positions specific to ${area}…`}
                                        rows={6}
                                        maxLength={20000}
                                        className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring resize-y"
                                    />
                                </div>
                            </details>
                        );
                    })}
                </div>
                <div className="flex justify-end mt-3">
                    <Button
                        onClick={handleSaveAreaProfiles}
                        disabled={isSavingAreas || !areasDirty || areasSaved}
                        className="min-w-[80px] transition-all bg-black hover:bg-gray-900 text-white"
                    >
                        {isSavingAreas ? (
                            "Saving..."
                        ) : areasSaved ? (
                            <>
                                <Check className="h-4 w-3" />
                                Saved
                            </>
                        ) : (
                            "Save area profiles"
                        )}
                    </Button>
                </div>
            </div>

            {/* Plan */}
            <div className="py-6">
                <div className="flex items-center gap-2 mb-4">
                    <h2 className="text-2xl font-medium font-serif">
                        Usage Plan
                    </h2>
                </div>
                <div>
                    <p className="text-base font-medium text-gray-500 capitalize">
                        {profile?.tier || "Free"}
                    </p>
                </div>
            </div>

            {/* Actions */}
            <div className="py-6">
                <h2 className="text-2xl font-medium font-serif mb-4">
                    Actions
                </h2>
                <Button
                    variant="outline"
                    onClick={handleLogout}
                    className="w-full sm:w-auto"
                >
                    <LogOut className="h-4 w-4 mr-2" />
                    Sign Out
                </Button>
            </div>

            {/* Danger Zone */}
            <div className="py-6">
                <h2 className="text-2xl font-medium font-serif mb-1 text-red-600">
                    Danger Zone
                </h2>
                <p className="text-sm text-gray-500 mb-4">
                    Permanently delete your account and all associated data.
                    This action cannot be undone.
                </p>
                {deleteConfirm ? (
                    <div className="rounded-lg border border-red-200 bg-red-50 p-4 space-y-3 max-w-sm">
                        <p className="text-sm font-medium text-red-700">
                            Are you sure? This will permanently delete your
                            account.
                        </p>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                onClick={() => setDeleteConfirm(false)}
                                disabled={isDeleting}
                                className="text-sm"
                            >
                                Cancel
                            </Button>
                            <Button
                                onClick={handleDeleteAccount}
                                disabled={isDeleting}
                                className="text-sm bg-red-600 hover:bg-red-700 text-white"
                            >
                                {isDeleting ? "Deleting…" : "Delete Account"}
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button
                        variant="outline"
                        onClick={() => setDeleteConfirm(true)}
                        className="w-full sm:w-auto border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
                    >
                        Delete Account
                    </Button>
                )}
            </div>
        </div>
    );
}
