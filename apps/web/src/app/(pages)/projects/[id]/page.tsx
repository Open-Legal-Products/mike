"use client";

import { use } from "react";
import { ProjectDocumentsView } from "@/app/components/projects/ProjectDocumentsView";

interface Props {
    params: Promise<{ id: string }>;
}

export default function ProjectDetailPage({ params }: Props) {
    const { id } = use(params);
    return <ProjectDocumentsView projectId={id} />;
}
