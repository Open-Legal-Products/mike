"use client";

import { use } from "react";
import { ProjectMatterWorkspace } from "@/app/components/projects/ProjectMatterWorkspace";

interface Props {
    params: Promise<{ id: string }>;
}

export default function ProjectWorkspacePage({ params }: Props) {
    const { id } = use(params);
    return <ProjectMatterWorkspace projectId={id} />;
}
