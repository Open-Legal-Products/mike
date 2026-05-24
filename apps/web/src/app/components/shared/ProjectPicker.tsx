"use client";

import { useState } from "react";
import { Folder, Search, X } from "lucide-react";
import type { MikeProject } from "./types";

interface Props {
    projects: MikeProject[];
    loading: boolean;
    selectedId: string | null;
    onSelect: (id: string | null) => void;
}

export function ProjectPicker({ projects, loading, selectedId, onSelect }: Props) {
    const [search, setSearch] = useState("");
    const q = search.toLowerCase().trim();
    const filtered = q ? projects.filter((p) => p.name.toLowerCase().includes(q)) : projects;

    return (
        <>
            <div className="px-4 pt-1 pb-2">
                <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                    <Search className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <input
                        type="text"
                        placeholder="Search projects…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="flex-1 bg-transparent text-sm text-gray-700 placeholder:text-gray-400 outline-none"
                        autoFocus
                    />
                    {search && (
                        <button onClick={() => setSearch("")} className="text-gray-400 hover:text-gray-600">
                            <X className="h-3.5 w-3.5" />
                        </button>
                    )}
                </div>
            </div>
            <div className="flex-1 overflow-y-auto px-4 pb-2">
                {loading ? (
                    <div className="rounded-sm border border-gray-100 overflow-hidden">
                        <div className="flex items-center px-2 py-2">
                            <div className="h-3 w-14 rounded bg-gray-200 animate-pulse" />
                        </div>
                        {[65, 45, 80, 55, 70].map((w, i) => (
                            <div key={i} className="flex items-center gap-2 px-2 py-2">
                                <div className="h-3.5 w-3.5 rounded-full border border-gray-200 shrink-0" />
                                <div className="h-3.5 w-3.5 rounded bg-gray-200 animate-pulse shrink-0" />
                                <div className="h-3 rounded bg-gray-200 animate-pulse" style={{ width: `${w}%` }} />
                            </div>
                        ))}
                    </div>
                ) : filtered.length === 0 ? (
                    <p className="text-center text-sm text-gray-400 py-8">
                        {q ? "No matches found" : "No projects yet"}
                    </p>
                ) : (
                    <div className="rounded-sm border border-gray-100 overflow-hidden">
                        <div className="flex items-center justify-between px-2 py-2">
                            <p className="text-xs font-medium text-gray-400">Projects</p>
                        </div>
                        <div className="space-y-px">
                            {filtered.map((project) => {
                                const isSelected = selectedId === project.id;
                                return (
                                    <button
                                        key={project.id}
                                        onClick={() => onSelect(isSelected ? null : project.id)}
                                        className={`w-full flex items-center gap-2 px-2 py-2 text-xs transition-colors text-left ${isSelected ? "bg-gray-100" : "hover:bg-gray-50"}`}
                                    >
                                        <span className={`shrink-0 h-3.5 w-3.5 rounded-full border flex items-center justify-center ${isSelected ? "bg-gray-900 border-gray-900" : "border-gray-300"}`}>
                                            {isSelected && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                                        </span>
                                        <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                                        <span className={`flex-1 truncate ${isSelected ? "text-gray-900 font-medium" : "text-gray-700"}`}>
                                            {project.name}
                                            {project.cm_number && (
                                                <span className="ml-1 font-normal text-gray-400">(#{project.cm_number})</span>
                                            )}
                                        </span>
                                        <span className="shrink-0 text-gray-400">{project.document_count ?? 0}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
