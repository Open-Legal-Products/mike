"use client";

import type { ReactNode } from "react";
import { LibraryWorkspaceLayout } from "@/app/components/library/LibraryWorkspace";

export default function LibraryLayout({ children }: { children: ReactNode }) {
    return <LibraryWorkspaceLayout>{children}</LibraryWorkspaceLayout>;
}
