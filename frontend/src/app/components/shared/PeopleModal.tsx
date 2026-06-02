"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X, User, UserPlus, Loader2, Plus } from "lucide-react";
import type { ProjectPeople } from "@/app/lib/mikeApi";
import { useTranslations } from "next-intl";

/**
 * Any resource the modal can manage members for — projects today, tabular
 * reviews now, anything else with a `shared_with` email list later.
 */
export interface SharedResource {
    id: string;
    shared_with?: string[] | null;
}

interface Props {
    open: boolean;
    onClose: () => void;
    /** The thing being shared (project, review, …). */
    resource: SharedResource | null;
    /**
     * Resolve the owner + members roster for the given resource. Different
     * resource types hit different endpoints (`/projects/:id/people`,
     * `/tabular-review/:id/people`, …) so the caller passes the appropriate
     * fetcher.
     */
    fetchPeople: (id: string) => Promise<ProjectPeople>;
    /** Currently signed-in user's email — gets the "You" tag if it matches. */
    currentUserEmail?: string | null;
    breadcrumb: string[];
    /**
     * Persist a new shared_with list. Parent should PATCH the resource and
     * sync its local state on success. Throw to surface an error inline.
     */
    onSharedWithChange?: (sharedWith: string[]) => Promise<void> | void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RosterRow = {
    email: string;
    display_name: string | null;
    role: "owner" | "member";
};

/**
 * Roster of every Mike member with access to the project, with controls to
 * add/remove members. Mirrors AddDocumentsModal's frame.
 */
export function PeopleModal({
    open,
    onClose,
    resource,
    fetchPeople,
    currentUserEmail,
    breadcrumb,
    onSharedWithChange,
}: Props) {
    const t = useTranslations("Shared.PeopleModal");
    const [newEmail, setNewEmail] = useState("");
    const [busy, setBusy] = useState<"add" | "remove" | null>(null);
    const [removingEmail, setRemovingEmail] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Server-resolved roster: owner email/display_name + members'
    // display_names. We keep `resource.shared_with` as the source of truth
    // for membership and just merge display_names from this fetch.
    const [people, setPeople] = useState<ProjectPeople | null>(null);
    const [peopleLoading, setPeopleLoading] = useState(false);

    const resourceId = resource?.id ?? null;
    const sharedWith: string[] = Array.isArray(resource?.shared_with)
        ? (resource!.shared_with as string[])
        : [];

    useEffect(() => {
        if (!open) return;
        setNewEmail("");
        setError(null);
        setBusy(null);
        setRemovingEmail(null);
    }, [open]);

    // Re-fetch roster whenever the modal opens or membership changes —
    // keyed by the joined shared_with list so add/remove triggers a refresh.
    const sharedKey = sharedWith
        .map((e) => e.toLowerCase())
        .sort()
        .join(",");

    useEffect(() => {
        if (!open || !resourceId) return;
        let cancelled = false;
        setPeopleLoading(true);
        fetchPeople(resourceId)
            .then((data) => {
                if (cancelled) return;
                setPeople(data);
            })
            .catch(() => {
                /* keep stale data; modal still works on emails alone */
            })
            .finally(() => {
                if (!cancelled) setPeopleLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [open, resourceId, sharedKey, fetchPeople]);

    if (!open || !resource) return null;

    const memberDisplayByEmail = new Map<string, string | null>();
    for (const m of people?.members ?? []) {
        memberDisplayByEmail.set(m.email.toLowerCase(), m.display_name);
    }
    const ownerEmail = people?.owner.email ?? null;
    const ownerDisplayName = people?.owner.display_name ?? null;

    const roster: RosterRow[] = [];
    if (ownerEmail) {
        roster.push({
            email: ownerEmail,
            display_name: ownerDisplayName,
            role: "owner",
        });
    }
    for (const email of sharedWith) {
        const lower = email.toLowerCase();
        if (ownerEmail && lower === ownerEmail.toLowerCase()) continue;
        roster.push({
            email,
            display_name: memberDisplayByEmail.get(lower) ?? null,
            role: "member",
        });
    }

    const trimmedNewEmail = newEmail.trim().toLowerCase();
    const normalizedCurrentUserEmail =
        currentUserEmail?.trim().toLowerCase() ?? null;
    const isValidEmail = EMAIL_RE.test(trimmedNewEmail);
    const sharedLower = sharedWith.map((e) => e.toLowerCase());
    const alreadyShared = sharedLower.includes(trimmedNewEmail);
    const isOwnerEmail =
        !!ownerEmail && trimmedNewEmail === ownerEmail.toLowerCase();
    const isSelfEmail =
        !!normalizedCurrentUserEmail &&
        trimmedNewEmail === normalizedCurrentUserEmail;
    const canAdd =
        isValidEmail &&
        !alreadyShared &&
        !isOwnerEmail &&
        !isSelfEmail &&
        busy === null;

    async function handleAdd() {
        if (!canAdd || !onSharedWithChange) return;
        setBusy("add");
        setError(null);
        try {
            const next = [...sharedWith, trimmedNewEmail];
            await onSharedWithChange(next);
            setNewEmail("");
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("errorAdd"),
            );
        } finally {
            setBusy(null);
        }
    }

    async function handleRemove(email: string) {
        if (!onSharedWithChange || busy !== null) return;
        setBusy("remove");
        setRemovingEmail(email);
        setError(null);
        try {
            const next = sharedWith.filter(
                (e) => e.toLowerCase() !== email.toLowerCase(),
            );
            await onSharedWithChange(next);
        } catch (e) {
            setError(
                e instanceof Error
                    ? e.message
                    : t("errorRemove"),
            );
        } finally {
            setBusy(null);
            setRemovingEmail(null);
        }
    }

    return createPortal(
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/10 backdrop-blur-xs">
            <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl flex flex-col h-[600px]">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4">
                    <div className="flex items-center gap-1.5 text-xs text-gray-400">
                        {breadcrumb.map((segment, i) => (
                            <span key={i} className="flex items-center gap-1.5">
                                {i > 0 && <span>›</span>}
                                {segment}
                            </span>
                        ))}
                    </div>
                    <button
                        onClick={onClose}
                        className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>

                {/* Add-member row */}
                {onSharedWithChange && (
                    <div className="px-4 pt-1 pb-2">
                        <div className="flex items-center gap-2">
                            <div className="flex flex-1 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                                <UserPlus className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                <input
                                    type="email"
                                    placeholder={t("addByEmailPlaceholder")}
                                    value={newEmail}
                                    onChange={(e) =>
                                        setNewEmail(e.target.value)
                                    }
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") void handleAdd();
                                    }}
                                    className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none"
                                    autoFocus
                                />
                            </div>
                            <button
                                onClick={() => void handleAdd()}
                                disabled={!canAdd}
                                title={t("addMemberTitle")}
                                className="inline-flex items-center justify-center rounded-lg border border-gray-900 bg-gray-900 p-2 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {busy === "add" ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Plus className="h-3.5 w-3.5" />
                                )}
                            </button>
                        </div>
                        {alreadyShared && trimmedNewEmail && (
                            <p className="mt-1.5 text-xs text-gray-400">
                                {t("hintAlreadyShared", { email: trimmedNewEmail })}
                            </p>
                        )}
                        {isOwnerEmail && trimmedNewEmail && (
                            <p className="mt-1.5 text-xs text-gray-400">
                                {t("hintIsOwner", { email: trimmedNewEmail })}
                            </p>
                        )}
                        {isSelfEmail && !isOwnerEmail && trimmedNewEmail && (
                            <p className="mt-1.5 text-xs text-gray-400">
                                {t("hintSelf")}
                            </p>
                        )}
                        {trimmedNewEmail &&
                            !isValidEmail &&
                            !alreadyShared &&
                            !isOwnerEmail &&
                            !isSelfEmail && (
                                <p className="mt-1.5 text-xs text-gray-400">
                                    {t("hintInvalidEmail")}
                                </p>
                            )}
                        {error && (
                            <p className="mt-1.5 text-xs text-red-500">
                                {error}
                            </p>
                        )}
                    </div>
                )}

                {/* Section heading */}
                <div className="px-4 pt-3 pb-1 flex items-center gap-2">
                    <h3 className="text-xs font-medium text-gray-500">
                        {t("sectionHeading")}
                    </h3>
                    {peopleLoading && (
                        <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                    )}
                </div>

                {/* Member list */}
                <div className="flex-1 overflow-y-auto px-4 pb-2">
                    {roster.length === 0 ? (
                        <div className="flex h-full items-center justify-center text-sm text-gray-400">
                            {t("emptyRoster")}
                        </div>
                    ) : (
                        <ul className="divide-y divide-gray-100 [&>li:nth-child(2)]:border-t-0">
                            {roster.map((entry) => {
                                const isYou =
                                    !!currentUserEmail &&
                                    entry.email.toLowerCase() ===
                                        currentUserEmail.toLowerCase();
                                const isRemoving =
                                    busy === "remove" &&
                                    removingEmail === entry.email;
                                const primary =
                                    entry.display_name?.trim() || entry.email;
                                const showSecondary =
                                    !!entry.display_name?.trim() &&
                                    primary !== entry.email;
                                return (
                                    <li
                                        key={`${entry.role}-${entry.email}`}
                                        className="flex items-center gap-3 py-3"
                                    >
                                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-900 text-white">
                                            <User className="h-3 w-3" />
                                        </div>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm text-gray-800">
                                                {primary}
                                                {isYou && (
                                                    <span className="ml-1.5 text-xs text-gray-400">
                                                        {t("tagYou")}
                                                    </span>
                                                )}
                                                {entry.role === "owner" && (
                                                    <span className="ml-1.5 text-[10px] text-gray-400">
                                                        {t("tagOwner")}
                                                    </span>
                                                )}
                                            </p>
                                            {showSecondary && (
                                                <p className="truncate text-xs text-gray-400">
                                                    {entry.email}
                                                </p>
                                            )}
                                        </div>
                                        {entry.role === "member" &&
                                            onSharedWithChange && (
                                                <button
                                                    onClick={() =>
                                                        void handleRemove(
                                                            entry.email,
                                                        )
                                                    }
                                                    disabled={busy !== null}
                                                    title={t("removeAccessTitle")}
                                                    className="self-center inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-gray-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                                                >
                                                    {isRemoving && (
                                                        <Loader2 className="h-3 w-3 animate-spin" />
                                                    )}
                                                    {t("removeLabel")}
                                                </button>
                                            )}
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 text-[11px] text-gray-400">
                    {roster.length === 0
                        ? t("emptyRoster")
                        : t("footerCount", { count: roster.length })}
                </div>
            </div>
        </div>,
        document.body,
    );
}
