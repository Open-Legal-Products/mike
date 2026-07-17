"use client";

import { use } from "react";
import { WorkflowDetailPage } from "@/app/components/workflows/WorkflowDetailPage";

interface Props {
    params: Promise<{ id: string }>;
}

export default function TabularReviewWorkflowPage({ params }: Props) {
    const { id } = use(params);
    return <WorkflowDetailPage id={id} workflowType="tabular" />;
}
