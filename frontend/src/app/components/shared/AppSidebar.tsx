"use client";

import { useState, useEffect, useMemo } from "react";
import {
    PanelLeft,
    MessageSquare,
    FolderOpen,
    Table2,
    Library,
    User,
    ChevronsUpDown,
    ChevronDown,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useUserProfile } from "@/contexts/UserProfileContext";
import { useChatHistoryContext } from "@/app/contexts/ChatHistoryContext";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { MikeIcon } from "@/components/chat/mike-icon";
import { SidebarChatItem } from "@/app/components/shared/SidebarChatItem";
import { listProjects } from "@/app/lib/mikeApi";
import type { Project } from "@/app/components/shared/types";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
    { href: "/assistant", label: "Assistant", icon: MessageSquare },
    { href: "/projects", label: "Projects", icon: FolderOpen },
    { href: "/tabular-reviews", label: "Tabular Review", icon: Table2 },
    { href: "/workflows", label: "Workflows", icon: Library },
];

interface AppSidebarProps {
    isOpen: boolean;
    onToggle: () => void;
}

export function AppSidebar({ isOpen, onToggle }: AppSidebarProps) {
    const { user } = useAuth();
    const { profile } = useUserProfile();
    const { chats, hasMoreChats, loadMoreChats, setCurrentChatId } =
        useChatHistoryContext();
    const router = useRouter();
    const pathname = usePathname();
    const routeChatId = useMemo(() => {
        if (pathname.startsWith("/assistant/chat/")) {
            return pathname.split("/").pop() ?? null;
        }

        const projectChatMatch = pathname.match(
            /^\/projects\/[^/]+\/assistant\/chat\/([^/]+)/,
        );
        return projectChatMatch?.[1] ?? null;
    }, [pathname]);
    const [shouldAnimate, setShouldAnimate] = useState(false);
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [projectsCollapsed, setProjectsCollapsed] = useState(false);
    const [historyCollapsed, setHistoryCollapsed] = useState(false);
    const [projectNames, setProjectNames] = useState<Record<string, string>>(
        {},
    );
    const [recentProjects, setRecentProjects] = useState<Project[] | null>(
        null,
    );

    useEffect(() => {
        if (!user) return;
        listProjects()
            .then((projects) => {
                const map: Record<string, string> = {};
                for (const p of projects) map[p.id] = p.name;
                setProjectNames(map);
                setRecentProjects(
                    [...projects]
                        .sort(
                            (a, b) =>
                                Date.parse(b.updated_at || b.created_at) -
                                Date.parse(a.updated_at || a.created_at),
                        )
                        .slice(0, 5),
                );
            })
            .catch(() => {
                setProjectNames({});
                setRecentProjects([]);
            });
    }, [user]);

    useEffect(() => {
        if (!isOpen) setShouldAnimate(true);
    }, [isOpen]);

    useEffect(() => {
        const handleClickOutside = () => setIsDropdownOpen(false);
        if (isDropdownOpen) {
            document.addEventListener("click", handleClickOutside);
            return () =>
                document.removeEventListener("click", handleClickOutside);
        }
    }, [isDropdownOpen]);

    useEffect(() => {
        setCurrentChatId(routeChatId);
    }, [routeChatId, setCurrentChatId]);

    const getUserInitials = (email: string) => {
        if (profile?.displayName)
            return profile.displayName.charAt(0).toUpperCase();
        return email.charAt(0).toUpperCase();
    };

    const getDisplayName = () => {
        if (!profile) return "";
        return profile.displayName || user?.email?.split("@")[0] || "";
    };

    const getUserTier = () => {
        if (!profile) return "";
        return profile.tier || "Free";
    };

    if (!user) return null;

    return (
        <div
            className={cn(
                isOpen
                    ? "w-64 h-[calc(100dvh-1rem)] md:h-[calc(100dvh-1.5rem)] bg-white/65"
                    : "max-md:hidden w-14 md:h-[calc(100dvh-1.5rem)] md:bg-white/65 h-auto bg-transparent pointer-events-none md:pointer-events-auto",
                "my-2 ml-2 mr-0 md:my-3 md:ml-3 md:mr-0 rounded-2xl border border-white/70 shadow-[0_-2px_7px_rgba(15,23,42,0.044),0_5px_12px_rgba(15,23,42,0.095),inset_0_1px_0_rgba(255,255,255,0.85)] backdrop-blur-2xl overflow-visible",
                "flex flex-col transition-all duration-300 absolute md:relative z-[99]",
            )}
        >
            {/* Toggle + Logo */}
            <div
                className={`items-center justify-between px-2.5 py-3 ${
                    !isOpen ? "hidden md:flex" : "flex"
                }`}
            >
                {isOpen && (
                    <div className="px-2">
                        <Link
                            href="/assistant"
                            className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                        >
                            <MikeIcon size={22} />
                            <span
                                className={`text-2xl font-light font-serif ${
                                    shouldAnimate ? "sidebar-fade-in" : ""
                                }`}
                            >
                                Mike
                            </span>
                        </Link>
                    </div>
                )}
                <button
                    onClick={onToggle}
                    className={cn(
                        "h-9 w-9 p-2.5 items-center flex transition-colors",
                        "rounded-md hover:bg-gray-100",
                    )}
                    title={isOpen ? "Close sidebar" : "Open sidebar"}
                >
                    <PanelLeft className="h-4 w-4" />
                </button>
            </div>

            {/* Nav items */}
            {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const isActive =
                    href === "/assistant"
                        ? pathname === href
                        : href === "/projects"
                          ? pathname === href
                          : pathname === href ||
                            pathname.startsWith(href + "/");
                return (
                    <div key={href} className="py-0.5 px-2.5">
                        <button
                            onClick={() => router.push(href)}
                            title={!isOpen ? label : ""}
                            className={cn(
                                "w-full h-9 flex items-center gap-3 px-2.5 py-2 rounded-md transition-colors text-left",
                                isActive
                                    ? "bg-gray-200/60 text-gray-900"
                                    : "text-gray-700 hover:bg-gray-100",
                                !isOpen ? "hidden md:flex" : "flex",
                            )}
                        >
                            <Icon
                                className={`h-4 w-4 flex-shrink-0 ${
                                    isActive ? "text-gray-900" : "text-black"
                                }`}
                            />
                            {isOpen && (
                                <span
                                    className={`text-sm font-medium ${
                                        shouldAnimate ? "sidebar-fade-in-2" : ""
                                    }`}
                                >
                                    {label}
                                </span>
                            )}
                        </button>
                    </div>
                );
            })}

            {isOpen && (
                <div className="mt-4 flex-1 min-h-0 flex flex-col gap-4">
                    {/* Recent Projects */}
                    <div>
                        <button
                            onClick={() => setProjectsCollapsed((v) => !v)}
                            className={`mb-2 flex w-full items-center justify-between px-5 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700 ${
                                shouldAnimate ? "sidebar-fade-in" : ""
                            }`}
                        >
                            <span>Recent Projects</span>
                            <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${
                                    projectsCollapsed ? "-rotate-90" : ""
                                }`}
                            />
                        </button>
                        {!projectsCollapsed && (
                            <>
                                {!recentProjects ? (
                                    <div className="space-y-1 px-2.5">
                                        {[50, 65, 45].map((w, i) => (
                                            <div
                                                key={i}
                                                className="h-9 flex items-center px-3 rounded-md"
                                            >
                                                <div
                                                    className="h-3 bg-gray-200 rounded animate-pulse"
                                                    style={{ width: `${w}%` }}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                ) : recentProjects.length === 0 ? (
                                    <div
                                        className={`px-5 py-2 text-xs text-gray-500 ${
                                            shouldAnimate
                                                ? "sidebar-fade-in-2"
                                                : ""
                                        }`}
                                    >
                                        No projects yet
                                    </div>
                                ) : (
                                    <div
                                        className={`space-y-1 px-2.5 ${
                                            shouldAnimate
                                                ? "sidebar-fade-in-2"
                                                : ""
                                        }`}
                                    >
                                        {recentProjects.map((project) => {
                                            const isActive =
                                                pathname ===
                                                    `/projects/${project.id}` ||
                                                pathname.startsWith(
                                                    `/projects/${project.id}/`,
                                                );
                                            return (
                                                <button
                                                    key={project.id}
                                                    onClick={() =>
                                                        router.push(
                                                            `/projects/${project.id}`,
                                                        )
                                                    }
                                                    title={project.name}
                                                    className={cn(
                                                        "flex h-9 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs transition-colors",
                                                        isActive
                                                            ? "bg-gray-200/60 text-gray-900"
                                                            : "text-gray-700 hover:bg-gray-100",
                                                    )}
                                                >
                                                    <FolderOpen className="h-3.5 w-3.5 shrink-0 text-gray-500" />
                                                    <span className="min-w-0 flex-1 truncate">
                                                        {project.name}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Assistant History */}
                    <div className="flex min-h-0 flex-1 flex-col">
                        <button
                            onClick={() => setHistoryCollapsed((v) => !v)}
                            className={`mb-2 flex w-full items-center justify-between px-5 text-xs font-semibold text-gray-500 transition-colors hover:text-gray-700 ${
                                shouldAnimate ? "sidebar-fade-in" : ""
                            }`}
                        >
                            <span>Assistant History</span>
                            <ChevronDown
                                className={`h-3.5 w-3.5 transition-transform ${
                                    historyCollapsed ? "-rotate-90" : ""
                                }`}
                            />
                        </button>
                        <div
                            className={`overflow-y-auto flex-1 ${
                                historyCollapsed ? "hidden" : ""
                            }`}
                        >
                            {!chats ? (
                                <div className="space-y-1 px-2.5">
                                    {[40, 60, 50, 70, 45].map((w, i) => (
                                        <div
                                            key={i}
                                            className="h-9 flex items-center px-3 rounded-md"
                                        >
                                            <div
                                                className="h-3 bg-gray-200 rounded animate-pulse"
                                                style={{ width: `${w}%` }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            ) : chats.length === 0 ? (
                                <div
                                    className={`text-xs text-gray-500 py-2 px-5 ${
                                        shouldAnimate ? "sidebar-fade-in-2" : ""
                                    }`}
                                >
                                    No chats yet
                                </div>
                            ) : (
                                <>
                                    <div
                                        className={`space-y-1 px-2.5 ${
                                            shouldAnimate
                                                ? "sidebar-fade-in-2"
                                                : ""
                                        }`}
                                    >
                                        {chats.map((chat) => (
                                            <SidebarChatItem
                                                key={chat.id}
                                                chat={chat}
                                                isActive={
                                                    routeChatId === chat.id
                                                }
                                                projectName={
                                                    chat.project_id
                                                        ? projectNames[
                                                              chat.project_id
                                                          ]
                                                        : undefined
                                                }
                                                onSelect={() => {
                                                    setCurrentChatId(chat.id);
                                                    router.push(
                                                        chat.project_id
                                                            ? `/projects/${chat.project_id}/assistant/chat/${chat.id}`
                                                            : `/assistant/chat/${chat.id}`,
                                                    );
                                                }}
                                            />
                                        ))}
                                    </div>
                                    {hasMoreChats && (
                                        <div className="px-2.5 pt-1">
                                            <button
                                                onClick={loadMoreChats}
                                                className={cn(
                                                    "flex h-8 w-full items-center justify-start rounded-md px-3 text-left text-xs font-medium text-gray-500 transition-colors hover:text-gray-700",
                                                    "hover:bg-gray-100",
                                                )}
                                            >
                                                Load more
                                            </button>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* User Profile */}
            <div className="mt-auto p-1">
                {user && (
                    <div className="relative">
                        <button
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className={cn(
                                "flex items-center transition-colors w-full px-2.5 py-3 border-t",
                                "rounded-xl border-white/60",
                                !isOpen ? "hidden md:flex" : "",
                                pathname === "/account" || isDropdownOpen
                                    ? "bg-gray-200/60"
                                    : "hover:bg-gray-100",
                            )}
                            title={!isOpen ? user.email : undefined}
                        >
                            <div className="h-6.5 w-6.5 flex-shrink-0 rounded-full bg-gray-700 flex items-center justify-center text-white text-sm font-medium font-serif">
                                {getUserInitials(user.email)}
                            </div>
                            {isOpen && (
                                <div
                                    className={`text-left flex-1 min-w-0 pl-3 flex items-center justify-between gap-2 ${
                                        shouldAnimate ? "sidebar-fade-in-2" : ""
                                    }`}
                                >
                                    <div className="flex flex-col gap-0.5 min-w-0">
                                        <div className="text-sm font-medium text-gray-900 leading-none">
                                            {getDisplayName()}
                                        </div>
                                        <div className="text-[12px] text-gray-500 leading-none">
                                            {getUserTier()}
                                        </div>
                                    </div>
                                    <ChevronsUpDown className="h-4 w-4 flex-shrink-0 text-gray-400" />
                                </div>
                            )}
                        </button>

                        {isDropdownOpen && (
                            <div
                                className={cn(
                                    "absolute bottom-full left-0 z-50 mb-1 p-1 whitespace-nowrap",
                                    isOpen ? "right-0" : "w-56",
                                    "bg-white/80 rounded-xl shadow-[0_6px_17px_rgba(15,23,42,0.1)] border border-white/70 backdrop-blur-xl",
                                )}
                            >
                                <button
                                    onClick={() => {
                                        router.push("/account");
                                        setIsDropdownOpen(false);
                                    }}
                                    className={cn(
                                        "w-full px-4 py-2 text-left text-sm text-gray-700 flex items-center gap-2 rounded-md",
                                        "hover:bg-white/70",
                                    )}
                                >
                                    <User className="h-4 w-4" />
                                    Account Settings
                                </button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
