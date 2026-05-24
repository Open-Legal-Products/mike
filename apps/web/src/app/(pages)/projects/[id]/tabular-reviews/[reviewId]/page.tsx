"use client";

import { use } from "react";
import { TRView } from "@/app/components/tabular/TabularReviewView";

interface Props {
    params: Promise<{ id: string; reviewId: string }>;
}

export default function ProjectTabularReviewPage({ params }: Props) {
    const { id, reviewId } = use(params);
    return <TRView reviewId={reviewId} projectId={id} />;
}
