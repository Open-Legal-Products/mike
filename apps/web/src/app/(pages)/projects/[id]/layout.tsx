"use client";

import type { ReactNode } from "react";
import { ProjectWorkspaceLayout } from "@/app/components/projects/ProjectWorkspace";

export default function ProjectLayout({
    params,
    children,
}: {
    params: Promise<{ id: string }>;
    children: ReactNode;
}) {
    return (
        <ProjectWorkspaceLayout params={params}>{children}</ProjectWorkspaceLayout>
    );
}
