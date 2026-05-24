"use client";

import { use } from "react";
import { ProjectPage } from "@/app/components/projects/ProjectPage";

interface Props {
    params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: Props) {
    const { id } = use(params);
    return <ProjectPage projectId={id} />;
}
