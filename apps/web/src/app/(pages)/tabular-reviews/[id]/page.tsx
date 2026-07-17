"use client";

import { use } from "react";
import { TRView } from "@/app/components/tabular/TabularReviewView";

interface Props {
    params: Promise<{ id: string }>;
}

export default function TabularReviewPage({ params }: Props) {
    const { id } = use(params);
    return <TRView reviewId={id} />;
}
