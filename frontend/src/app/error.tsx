"use client";

import Link from "next/link";
import { useEffect } from "react";
import { PillButton } from "@/app/components/ui/pill-button";

export default function Error({
    error,
}: {
    error: Error & { digest?: string };
}) {
    useEffect(() => {
        console.error("App error:", error);
    }, [error]);

    return (
        <div className="min-h-screen bg-white flex items-center justify-center px-4">
            <div className="text-center max-w-md">
                <h1 className="text-3xl font-eb-garamond font-light text-gray-900 mb-3">
                    出错了
                </h1>
                <p className="text-[0.9375rem] text-gray-500 leading-relaxed mb-8">
                    遇到了意外错误。错误已记录，我们的团队将进行排查。
                </p>

                <PillButton asChild tone="black" size="normal">
                    <Link href="/">首页</Link>
                </PillButton>
            </div>
        </div>
    );
}
