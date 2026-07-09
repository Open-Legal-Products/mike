"use client";

import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
import {
    deleteTabularReview,
    updateTabularReview,
} from "@/app/lib/mikeApi";
import { ProjectReviewsTable } from "@/app/components/projects/ProjectReviewsTable";
import { TabularReviewDetailsModal } from "@/app/components/tabular/TabularReviewDetailsModal";
import {
    ProjectSectionToolbar,
    useProjectWorkspace,
} from "@/app/components/projects/ProjectWorkspace";
import type { TabularReview } from "@/app/components/shared/types";
import { useAuth } from "@/app/contexts/AuthContext";

interface Props {
    params: Promise<{ id: string }>;
}

function SelectedReviewActions({
    selectedCount,
    open,
    onOpenChange,
    onDelete,
}: {
    selectedCount: number;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onDelete: () => void;
}) {
    if (selectedCount === 0) return null;

    return (
        <div className="relative">
            <button
                onClick={() => onOpenChange(!open)}
                className="flex items-center gap-1 text-xs font-medium text-gray-700 transition-colors hover:text-gray-900"
            >
                Actions
                <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {open && (
                <div className="absolute right-0 top-full z-[120] mt-1 w-36 overflow-hidden rounded-lg border border-white/60 bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_12px_32px_rgba(15,23,42,0.14)] backdrop-blur-xl">
                    <button
                        onClick={onDelete}
                        className="w-full px-3 py-1.5 text-left text-xs text-red-600 transition-colors hover:bg-red-50"
                    >
                        Delete
                    </button>
                </div>
            )}
        </div>
    );
}

export default function ProjectTabularReviewsPage({ params }: Props) {
    use(params);
    const workspace = useProjectWorkspace();
    const router = useRouter();
    const { user } = useAuth();
    const {
        ensureProjectReviews,
        project,
        projectId,
        projectReviews,
        search,
        setOwnerOnlyAction,
        setProjectReviews,
    } = workspace;
    const [selectedReviewIds, setSelectedReviewIds] = useState<string[]>([]);
    const [detailsReview, setDetailsReview] = useState<TabularReview | null>(
        null,
    );
    const [actionsOpen, setActionsOpen] = useState(false);
    const docs = project?.documents ?? [];
    const reviews = useMemo(() => projectReviews ?? [], [projectReviews]);
    const loading = projectReviews === null;

    useEffect(() => {
        void ensureProjectReviews();
    }, [ensureProjectReviews]);

    const q = search.toLowerCase();
    const filteredReviews = q
        ? reviews.filter((r) => (r.title ?? "").toLowerCase().includes(q))
        : reviews;
    const allReviewsSelected =
        filteredReviews.length > 0 &&
        filteredReviews.every((r) => selectedReviewIds.includes(r.id));
    const someReviewsSelected =
        !allReviewsSelected &&
        filteredReviews.some((r) => selectedReviewIds.includes(r.id));

    function handleOpenDetails(review: TabularReview) {
        if (user?.id && review.user_id !== user.id) {
            setOwnerOnlyAction("edit tabular review details");
            return;
        }
        setDetailsReview(review);
    }

    async function handleDetailsSave(values: {
        title: string;
        projectId?: string | null;
    }) {
        if (!detailsReview) return;
        if (user?.id && detailsReview.user_id !== user.id) {
            setOwnerOnlyAction("edit tabular review details");
            return;
        }
        const updated = await updateTabularReview(detailsReview.id, {
            title: values.title,
            project_id: projectId,
        });
        setProjectReviews((prev) =>
            (prev ?? []).map((review) =>
                review.id === updated.id ? { ...review, ...updated } : review,
            ),
        );
        setDetailsReview((current) =>
            current?.id === updated.id ? { ...current, ...updated } : current,
        );
    }

    async function handleDeleteReviewRow(review: TabularReview) {
        if (user?.id && review.user_id !== user.id) {
            setOwnerOnlyAction("delete this tabular review");
            return;
        }
        await deleteTabularReview(review.id);
        setProjectReviews((prev) =>
            (prev ?? []).filter((r) => r.id !== review.id),
        );
    }

    const handleDeleteSelectedReviews = useCallback(async () => {
        const ids = [...selectedReviewIds];
        setActionsOpen(false);
        const owned = ids.filter((id) => {
            const review = reviews.find((r) => r.id === id);
            return !review || review.user_id === user?.id;
        });
        const blocked = ids.length - owned.length;
        setSelectedReviewIds([]);
        await Promise.all(
            owned.map((id) => deleteTabularReview(id).catch(() => {})),
        );
        setProjectReviews((prev) =>
            (prev ?? []).filter((review) => !owned.includes(review.id)),
        );
        if (blocked > 0) {
            setOwnerOnlyAction(
                `delete ${blocked} of the selected reviews - only the review creator can delete a review`,
            );
        }
    }, [
        reviews,
        selectedReviewIds,
        setOwnerOnlyAction,
        setProjectReviews,
        user?.id,
    ]);

    return (
        <>
            <ProjectSectionToolbar
                actions={
                    <SelectedReviewActions
                        selectedCount={selectedReviewIds.length}
                        open={actionsOpen}
                        onOpenChange={setActionsOpen}
                        onDelete={() => void handleDeleteSelectedReviews()}
                    />
                }
            />
            <ProjectReviewsTable
                docs={docs}
                reviews={reviews}
                filteredReviews={filteredReviews}
                selectedReviewIds={selectedReviewIds}
                allReviewsSelected={allReviewsSelected}
                someReviewsSelected={someReviewsSelected}
                creatingReview={workspace.creatingReview}
                currentUserId={user?.id}
                loading={loading}
                onCreateReview={workspace.openNewReview}
                onOpenReview={(reviewId) =>
                    router.push(
                        `/projects/${projectId}/tabular-reviews/${reviewId}`,
                    )
                }
                onOpenDetails={handleOpenDetails}
                onDeleteReview={handleDeleteReviewRow}
                onOwnerOnlyAction={setOwnerOnlyAction}
                setSelectedReviewIds={setSelectedReviewIds}
            />
            <TabularReviewDetailsModal
                open={!!detailsReview}
                review={detailsReview}
                projects={project ? [project] : []}
                canEdit={
                    !!detailsReview &&
                    (!user?.id || detailsReview.user_id === user.id)
                }
                lockProject
                onClose={() => setDetailsReview(null)}
                onSave={handleDetailsSave}
            />
        </>
    );
}
