"use client";

import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { providerLabel, type ModelProvider } from "@/app/lib/modelAvailability";
import { WarningPopup } from "../popups/WarningPopup";

interface Props {
    open: boolean;
    onClose: () => void;
    provider: ModelProvider | null;
    /** Optional override for the body sentence. */
    message?: string;
}

export function ApiKeyMissingPopup({ open, onClose, provider, message }: Props) {
    const router = useRouter();
    if (!open) return null;

    const providerName = provider ? providerLabel(provider) : "该服务商";
    const body =
        message ??
        `您尚未添加 ${providerName} 的 API 密钥。请在账户设置中添加后再使用此模型。`;

    const handleGoToAccount = () => {
        onClose();
        router.push("/account/models");
    };

    return (
        <WarningPopup
            open={open}
            onClose={onClose}
            title="需要 API 密钥"
            message={body}
            icon={
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            }
            primaryAction={{
                label: "前往账户设置",
                onClick: handleGoToAccount,
            }}
        />
    );
}
