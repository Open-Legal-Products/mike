"use client";

import { useCallback, useEffect, useState } from "react";
import {
    Building2,
    ChevronDown,
    Loader2,
    Plus,
    Trash2,
    Users,
    X,
} from "lucide-react";
import { useAuth } from "@/app/contexts/AuthContext";
import { AddUserInput } from "@/app/components/shared/AddUserInput";
import { PillButton } from "@/app/components/ui/pill-button";
import { ConfirmPopup } from "@/app/components/popups/ConfirmPopup";
import {
    type Org,
    type OrgMember,
    type OrgRole,
    type OrgTeam,
    addOrgMember,
    addOrgTeamMember,
    createOrg,
    createOrgTeam,
    deleteOrgTeam,
    listOrgMembers,
    listOrgTeams,
    listOrgs,
    removeOrgMember,
    removeOrgTeamMember,
    updateOrgMember,
} from "@/app/lib/mikeApi";
import { cn } from "@/app/lib/utils";
import { SETTINGS_CONTROL_CLASS } from "@/app/components/settings/SettingsTextInput";
import { SettingsSection } from "../SettingsSection";

const ROLE_LABELS: Record<OrgRole, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
};

const ROLE_DESCRIPTIONS: Record<OrgRole, string> = {
    owner: "Full control, including granting the owner role.",
    admin: "Manages members, teams and the firm's shared content.",
    member: "Sees the firm's shared content (read-only).",
};

function roleCanManage(role: OrgRole | null | undefined): boolean {
    return role === "owner" || role === "admin";
}

function memberLabel(m: {
    display_name: string | null;
    email: string | null;
    user_id: string;
}): string {
    return m.display_name || m.email || m.user_id;
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : "Something went wrong.";
}

export default function OrganizationsPage() {
    const { user } = useAuth();
    const [orgs, setOrgs] = useState<Org[] | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [newOrgName, setNewOrgName] = useState("");
    const [creatingOrg, setCreatingOrg] = useState(false);
    const [createError, setCreateError] = useState<string | null>(null);
    const [openOrgId, setOpenOrgId] = useState<string | null>(null);

    const loadOrgs = useCallback(async () => {
        try {
            const rows = await listOrgs();
            // The auto-provisioned personal org is private plumbing — every
            // account has one and it should not read as a manageable firm.
            setOrgs(rows.filter((o) => !o.personal));
            setLoadError(null);
        } catch (err) {
            console.error("Failed to load organizations", err);
            setLoadError("Could not load organizations.");
        }
    }, []);

    useEffect(() => {
        void loadOrgs();
    }, [loadOrgs]);

    async function handleCreateOrg() {
        const name = newOrgName.trim();
        if (!name || creatingOrg) return;
        setCreatingOrg(true);
        setCreateError(null);
        try {
            const org = await createOrg(name);
            setNewOrgName("");
            setOrgs((prev) => [...(prev ?? []), org]);
            setOpenOrgId(org.id);
        } catch (err) {
            setCreateError(errorMessage(err));
        } finally {
            setCreatingOrg(false);
        }
    }

    return (
        <div className="space-y-8">
            <section className="space-y-4">
                <div>
                    <h2 className="text-2xl font-medium font-serif">
                        Organizations
                    </h2>
                    <p className="mt-1 text-sm text-gray-600">
                        A firm is not one user. Create an organization to share
                        projects, documents, workflows and reviews with
                        colleagues — owners and admins manage, members can
                        view. Your private workspace stays separate.
                    </p>
                </div>

                <SettingsSection className="p-4">
                    <div className="flex items-center gap-2">
                        <input
                            type="text"
                            value={newOrgName}
                            onChange={(e) => setNewOrgName(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") void handleCreateOrg();
                            }}
                            placeholder="New organization name…"
                            className={cn(SETTINGS_CONTROL_CLASS, "flex-1")}
                        />
                        <PillButton
                            tone="black"
                            size="sm"
                            onClick={() => void handleCreateOrg()}
                            disabled={!newOrgName.trim() || creatingOrg}
                        >
                            {creatingOrg ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                                <Plus className="h-3.5 w-3.5" />
                            )}
                            Create organization
                        </PillButton>
                    </div>
                    {createError ? (
                        <p className="mt-2 text-xs text-red-500">
                            {createError}
                        </p>
                    ) : null}
                </SettingsSection>

                {loadError ? (
                    <p className="text-sm text-red-500">{loadError}</p>
                ) : orgs === null ? (
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Loading organizations…
                    </div>
                ) : orgs.length === 0 ? (
                    <p className="text-sm text-gray-600">
                        You are not part of any organization yet.
                    </p>
                ) : (
                    <div className="space-y-3">
                        {orgs.map((org) => (
                            <OrgCard
                                key={org.id}
                                org={org}
                                currentUserId={user?.id ?? null}
                                open={openOrgId === org.id}
                                onToggle={() =>
                                    setOpenOrgId((prev) =>
                                        prev === org.id ? null : org.id,
                                    )
                                }
                                onLeftOrg={() => {
                                    setOpenOrgId(null);
                                    void loadOrgs();
                                }}
                            />
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}

function OrgCard({
    org,
    currentUserId,
    open,
    onToggle,
    onLeftOrg,
}: {
    org: Org;
    currentUserId: string | null;
    open: boolean;
    onToggle: () => void;
    onLeftOrg: () => void;
}) {
    const canManage = roleCanManage(org.role);
    const [members, setMembers] = useState<OrgMember[] | null>(null);
    const [teams, setTeams] = useState<OrgTeam[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [newTeamName, setNewTeamName] = useState("");
    const [pendingRemove, setPendingRemove] = useState<OrgMember | null>(null);

    const refresh = useCallback(async () => {
        try {
            const [memberRows, teamRows] = await Promise.all([
                listOrgMembers(org.id),
                listOrgTeams(org.id),
            ]);
            setMembers(memberRows);
            setTeams(teamRows);
        } catch (err) {
            console.error("Failed to load organization detail", err);
            setError("Could not load this organization.");
        }
    }, [org.id]);

    useEffect(() => {
        if (open && members === null) void refresh();
    }, [open, members, refresh]);

    async function run(key: string, fn: () => Promise<void>) {
        if (busyKey) return;
        setBusyKey(key);
        setError(null);
        try {
            await fn();
        } catch (err) {
            setError(errorMessage(err));
        } finally {
            setBusyKey(null);
        }
    }

    return (
        <SettingsSection className="p-0">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center gap-3 p-4 text-left"
                aria-expanded={open}
            >
                <Building2 className="h-4 w-4 text-gray-600" />
                <span className="flex-1 text-sm font-medium text-gray-800">
                    {org.name}
                </span>
                <RoleBadge role={org.role} />
                <ChevronDown
                    className={cn(
                        "h-4 w-4 text-gray-500 transition-transform",
                        open && "rotate-180",
                    )}
                />
            </button>

            {open ? (
                <div className="space-y-6 border-t border-gray-200/60 p-4">
                    {error ? (
                        <p className="text-xs text-red-500">{error}</p>
                    ) : null}

                    <div className="space-y-3">
                        <h3 className="flex items-center gap-2 text-sm font-medium text-gray-700">
                            <Users className="h-3.5 w-3.5" /> Members
                        </h3>
                        {canManage ? (
                            <div className="max-w-md">
                                <AddUserInput
                                    placeholder="Add a colleague by email…"
                                    submitLabel="Add member"
                                    busy={busyKey === "add-member"}
                                    onAdd={(u) =>
                                        run("add-member", async () => {
                                            await addOrgMember(
                                                org.id,
                                                u.email,
                                                "member",
                                            );
                                            await refresh();
                                        })
                                    }
                                />
                            </div>
                        ) : null}
                        {members === null ? (
                            <div className="flex items-center gap-2 text-xs text-gray-600">
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                Loading members…
                            </div>
                        ) : (
                            <ul className="space-y-1">
                                {members.map((m) => {
                                    const isSelf =
                                        m.user_id === currentUserId;
                                    return (
                                        <li
                                            key={m.user_id}
                                            className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700 hover:bg-gray-100/60"
                                        >
                                            <span className="flex-1 truncate">
                                                {memberLabel(m)}
                                                {isSelf ? (
                                                    <span className="ml-1 text-xs text-gray-500">
                                                        (You)
                                                    </span>
                                                ) : null}
                                            </span>
                                            {canManage && !isSelf ? (
                                                <select
                                                    aria-label={`Role for ${memberLabel(m)}`}
                                                    value={m.role}
                                                    disabled={
                                                        busyKey ===
                                                        `role-${m.user_id}`
                                                    }
                                                    onChange={(e) =>
                                                        run(
                                                            `role-${m.user_id}`,
                                                            async () => {
                                                                await updateOrgMember(
                                                                    org.id,
                                                                    m.user_id,
                                                                    e.target
                                                                        .value as OrgRole,
                                                                );
                                                                await refresh();
                                                            },
                                                        )
                                                    }
                                                    className={cn(
                                                        SETTINGS_CONTROL_CLASS,
                                                        "w-28 py-1 text-xs",
                                                    )}
                                                    title={
                                                        ROLE_DESCRIPTIONS[
                                                            m.role
                                                        ]
                                                    }
                                                >
                                                    {(
                                                        [
                                                            "owner",
                                                            "admin",
                                                            "member",
                                                        ] as OrgRole[]
                                                    ).map((r) => (
                                                        <option
                                                            key={r}
                                                            value={r}
                                                        >
                                                            {ROLE_LABELS[r]}
                                                        </option>
                                                    ))}
                                                </select>
                                            ) : (
                                                <RoleBadge role={m.role} />
                                            )}
                                            {canManage || isSelf ? (
                                                <button
                                                    type="button"
                                                    aria-label={
                                                        isSelf
                                                            ? "Leave organization"
                                                            : `Remove ${memberLabel(m)}`
                                                    }
                                                    disabled={
                                                        busyKey ===
                                                        `remove-${m.user_id}`
                                                    }
                                                    onClick={() =>
                                                        setPendingRemove(m)
                                                    }
                                                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                                >
                                                    <X className="h-3.5 w-3.5" />
                                                </button>
                                            ) : null}
                                        </li>
                                    );
                                })}
                            </ul>
                        )}
                    </div>

                    <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-700">
                            Teams
                        </h3>
                        {canManage ? (
                            <div className="flex max-w-md items-center gap-2">
                                <input
                                    type="text"
                                    value={newTeamName}
                                    onChange={(e) =>
                                        setNewTeamName(e.target.value)
                                    }
                                    placeholder="New team name…"
                                    className={cn(
                                        SETTINGS_CONTROL_CLASS,
                                        "flex-1",
                                    )}
                                />
                                <PillButton
                                    tone="white"
                                    size="sm"
                                    disabled={
                                        !newTeamName.trim() ||
                                        busyKey === "create-team"
                                    }
                                    onClick={() =>
                                        run("create-team", async () => {
                                            await createOrgTeam(
                                                org.id,
                                                newTeamName.trim(),
                                            );
                                            setNewTeamName("");
                                            await refresh();
                                        })
                                    }
                                >
                                    <Plus className="h-3.5 w-3.5" /> Team
                                </PillButton>
                            </div>
                        ) : null}
                        {teams === null ? null : teams.length === 0 ? (
                            <p className="text-xs text-gray-500">
                                No teams yet.
                            </p>
                        ) : (
                            <ul className="space-y-2">
                                {teams.map((team) => (
                                    <li
                                        key={team.id}
                                        className="rounded-lg border border-gray-200/60 p-2"
                                    >
                                        <div className="flex items-center gap-2">
                                            <span className="flex-1 text-sm text-gray-800">
                                                {team.name}
                                            </span>
                                            {canManage ? (
                                                <button
                                                    type="button"
                                                    aria-label={`Delete team ${team.name}`}
                                                    disabled={
                                                        busyKey ===
                                                        `delete-team-${team.id}`
                                                    }
                                                    onClick={() =>
                                                        run(
                                                            `delete-team-${team.id}`,
                                                            async () => {
                                                                await deleteOrgTeam(
                                                                    org.id,
                                                                    team.id,
                                                                );
                                                                await refresh();
                                                            },
                                                        )
                                                    }
                                                    className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            ) : null}
                                        </div>
                                        <div className="mt-1 flex flex-wrap items-center gap-1">
                                            {team.members.map((tm) => (
                                                <span
                                                    key={tm.user_id}
                                                    className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700"
                                                >
                                                    {memberLabel(tm)}
                                                    {canManage ? (
                                                        <button
                                                            type="button"
                                                            aria-label={`Remove ${memberLabel(tm)} from ${team.name}`}
                                                            onClick={() =>
                                                                run(
                                                                    `team-remove-${team.id}-${tm.user_id}`,
                                                                    async () => {
                                                                        await removeOrgTeamMember(
                                                                            org.id,
                                                                            team.id,
                                                                            tm.user_id,
                                                                        );
                                                                        await refresh();
                                                                    },
                                                                )
                                                            }
                                                            className="text-gray-400 hover:text-red-600"
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </button>
                                                    ) : null}
                                                </span>
                                            ))}
                                            {canManage ? (
                                                <div className="min-w-52">
                                                    <AddUserInput
                                                        placeholder="Add to team…"
                                                        submitLabel="Add"
                                                        busy={
                                                            busyKey ===
                                                            `team-add-${team.id}`
                                                        }
                                                        onAdd={(u) =>
                                                            run(
                                                                `team-add-${team.id}`,
                                                                async () => {
                                                                    await addOrgTeamMember(
                                                                        org.id,
                                                                        team.id,
                                                                        u.email,
                                                                    );
                                                                    await refresh();
                                                                },
                                                            )
                                                        }
                                                    />
                                                </div>
                                            ) : null}
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
            ) : null}

            <ConfirmPopup
                open={pendingRemove !== null}
                title={
                    pendingRemove?.user_id === currentUserId
                        ? "Leave organization?"
                        : "Remove member?"
                }
                message={
                    pendingRemove
                        ? pendingRemove.user_id === currentUserId
                            ? `You will lose access to content shared in ${org.name}.`
                            : `${memberLabel(pendingRemove)} will lose access to content shared in ${org.name}.`
                        : ""
                }
                confirmLabel={
                    pendingRemove?.user_id === currentUserId
                        ? "Leave"
                        : "Remove"
                }
                confirmStatus={
                    busyKey === `remove-${pendingRemove?.user_id}`
                        ? "loading"
                        : "idle"
                }
                onCancel={() => setPendingRemove(null)}
                onConfirm={() => {
                    const target = pendingRemove;
                    if (!target) return;
                    void run(`remove-${target.user_id}`, async () => {
                        await removeOrgMember(org.id, target.user_id);
                        setPendingRemove(null);
                        if (target.user_id === currentUserId) onLeftOrg();
                        else await refresh();
                    });
                }}
            />
        </SettingsSection>
    );
}

function RoleBadge({ role }: { role: OrgRole }) {
    return (
        <span
            title={ROLE_DESCRIPTIONS[role]}
            className={cn(
                "rounded-full px-2 py-0.5 text-xs",
                role === "owner"
                    ? "bg-gray-950/88 text-white"
                    : role === "admin"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-600",
            )}
        >
            {ROLE_LABELS[role]}
        </span>
    );
}
