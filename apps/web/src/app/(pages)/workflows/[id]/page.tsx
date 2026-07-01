"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BUILT_IN_WORKFLOWS } from "@/app/components/workflows/builtinWorkflows";
import { workflowDetailPath } from "@/app/components/workflows/workflowRoutes";
import { getWorkflow } from "@/app/lib/mikeApi";

interface Props {
    params: Promise<{ id: string }>;
}

/**
 * Redirect shim for bare `/workflows/<id>` URLs.
 *
 * The detail pages live at type-scoped routes (`/workflows/assistant/<id>`,
 * `/workflows/tabular-review/<id>`), so a bare id — from a bookmark, a shared
 * link, or a direct navigation — would otherwise 404. This resolves the id's
 * type (built-ins synchronously, custom workflows via the API) and forwards to
 * the canonical typed path.
 *
 * Renders a deterministic loader so SSR and the first client render match (no
 * hydration divergence); the redirect happens in an effect after mount.
 */
export default function WorkflowRedirectPage({ params }: Props) {
    const { id } = use(params);
    const router = useRouter();
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        const builtin = BUILT_IN_WORKFLOWS.find((w) => w.id === id);
        if (builtin) {
            router.replace(workflowDetailPath(builtin));
            return;
        }

        let cancelled = false;
        getWorkflow(id)
            .then((wf) => {
                if (!cancelled) router.replace(workflowDetailPath(wf));
            })
            .catch(() => {
                // Unknown id (or unauthorized): fall back to the list rather
                // than stranding the user on a blank redirect screen.
                if (!cancelled) {
                    setFailed(true);
                    router.replace("/workflows");
                }
            });

        return () => {
            cancelled = true;
        };
    }, [id, router]);

    return (
        <div className="flex min-h-dvh items-center justify-center bg-gray-50/80">
            {!failed && (
                <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-700" />
            )}
        </div>
    );
}
